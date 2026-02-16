import { EventEmitter } from "node:events";
import { generateObject } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";
import { z } from "zod";

import type {
  SessionConfig,
  SessionEvents,
  TranscriptBlock,
  Summary,
  UIState,
  LanguageCode,
} from "./types";
import { log } from "./logger";
import { pcmToWavBuffer } from "./audio-utils";
import { toReadableError } from "./text-utils";
import {
  LANG_NAMES,
  getLanguageLabel,
  hasTranslatableContent,
  buildAudioPromptForStructured,
} from "./language";
import {
  createCostAccumulator,
  addCost as addCostToAcc,
  resetCost,
  type CostAccumulator,
} from "./cost";
import {
  createVadState,
  resetVadState,
  processAudioData,
  flushVad,
  type VadState,
} from "./vad";
import {
  createContextState,
  resetContextState,
  recordContext,
  getContextWindow,
  createBlock,
  loadUserContext,
  writeSummaryLog,
  type ContextState,
} from "./context";
import {
  checkMacOSVersion,
  createAudioRecorder,
  listAvfoundationDevices,
  selectAudioDevice,
  spawnFfmpeg,
  type AudioRecorder,
} from "./audio";

type TypedEmitter = EventEmitter & {
  emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean;
  on<K extends keyof SessionEvents>(event: K, listener: (...args: SessionEvents[K]) => void): TypedEmitter;
};

export class Session {
  readonly events: TypedEmitter = new EventEmitter() as TypedEmitter;
  readonly config: SessionConfig;

  private vertexModel: ReturnType<ReturnType<typeof createVertex>>;
  private audioTranscriptionSchema: z.ZodObject<z.ZodRawShape>;
  private summarySchema: z.ZodObject<z.ZodRawShape>;

  private isRecording = false;
  private audioRecorder: AudioRecorder | null = null;
  private ffmpegProcess: ReturnType<typeof spawnFfmpeg> | null = null;
  private legacyDevice: { index: number; name: string } | null = null;

  private vertexChunkQueue: Buffer[] = [];
  private vertexInFlight = 0;
  private readonly vertexMaxConcurrency = 5;
  private readonly vertexMaxQueueSize = 20;
  private vertexOverlap = Buffer.alloc(0);

  private vadState: VadState = createVadState();
  private contextState: ContextState = createContextState();
  private costAccumulator: CostAccumulator = createCostAccumulator();
  private userContext: string;

  private summaryTimer: NodeJS.Timeout | null = null;
  private summaryInFlight = false;
  private lastSummary: Summary | null = null;

  private sourceLangLabel: string;
  private targetLangLabel: string;
  private sourceLangName: string;
  private targetLangName: string;

  constructor(config: SessionConfig) {
    this.config = config;
    this.userContext = loadUserContext(config.contextFile, config.useContext);

    const vertex = createVertex({
      project: config.vertexProject,
      location: config.vertexLocation,
    });
    this.vertexModel = vertex(config.vertexModelId);

    this.sourceLangLabel = getLanguageLabel(config.sourceLang);
    this.targetLangLabel = getLanguageLabel(config.targetLang);
    this.sourceLangName = LANG_NAMES[config.sourceLang];
    this.targetLangName = LANG_NAMES[config.targetLang];

    const englishIsConfigured = config.sourceLang === "en" || config.targetLang === "en";
    const langEnumValues: [string, ...string[]] = englishIsConfigured
      ? [config.sourceLang, config.targetLang]
      : [config.sourceLang, config.targetLang, "en"];

    this.audioTranscriptionSchema = z.object({
      sourceLanguage: z
        .enum(langEnumValues)
        .describe(`The detected language: ${langEnumValues.map((c) => `"${c}" for ${LANG_NAMES[c as LanguageCode] ?? c}`).join(", ")}`),
      transcript: z
        .string()
        .describe("The transcription of the audio in the original language"),
      translation: z
        .string()
        .optional()
        .describe("The translation. Empty if audio is in English or matches target language."),
      isPartial: z
        .boolean()
        .describe("True if the audio was cut off mid-sentence (incomplete thought). False if speech ends at a natural sentence boundary or pause."),
      isNewTopic: z
        .boolean()
        .describe("True if the speaker shifted to a new topic or subject compared to the context. False if continuing the same topic or if no context is available."),
    });

    this.summarySchema = z.object({
      keyPoints: z.array(z.string()).describe("4 key points from the recent conversation"),
    });
  }

  getUIState(status: UIState["status"]): UIState {
    const langPair = `${this.sourceLangName} \u2192 ${this.targetLangName}`;
    const deviceName = this.config.legacyAudio && this.legacyDevice
      ? this.legacyDevice.name
      : "System Audio (ScreenCaptureKit)";
    return {
      deviceName,
      modelId: `${langPair} | ${this.config.vertexModelId}`,
      intervalMs: this.config.intervalMs,
      status,
      contextLoaded: !!this.userContext,
      cost: this.costAccumulator.totalCost,
    };
  }

  get recording(): boolean {
    return this.isRecording;
  }

  get allKeyPoints(): readonly string[] {
    return this.contextState.allKeyPoints;
  }

  async initialize(): Promise<void> {
    if (this.config.legacyAudio) {
      const devices = await listAvfoundationDevices();
      if (devices.length === 0) {
        throw new Error("No avfoundation audio devices found.");
      }
      this.legacyDevice = selectAudioDevice(devices, this.config.device);
      if (!this.legacyDevice) {
        throw new Error("No loopback device found. Use --device to override.");
      }
      log("INFO", `Selected device: [${this.legacyDevice.index}] ${this.legacyDevice.name}`);
    } else {
      const { supported, version } = checkMacOSVersion();
      if (!supported) {
        throw new Error(`ScreenCaptureKit requires macOS 14.2 or later (detected macOS ${version}).`);
      }
      log("INFO", "Using ScreenCaptureKit for system audio capture");
    }

    this.events.emit("state-change", this.getUIState("idle"));
  }

  async startRecording(): Promise<void> {
    if (this.isRecording) return;
    this.isRecording = true;

    resetVadState(this.vadState);
    resetContextState(this.contextState);
    resetCost(this.costAccumulator);
    this.vertexChunkQueue = [];
    this.vertexOverlap = Buffer.alloc(0);
    this.vertexInFlight = 0;
    this.lastSummary = null;

    this.events.emit("blocks-cleared");
    this.events.emit("summary-updated", null);
    this.events.emit("state-change", this.getUIState("connecting"));
    this.events.emit("status", "Connecting...");

    this.events.emit("state-change", this.getUIState("recording"));
    this.events.emit("status", "Streaming. Speak now.");

    if (this.config.legacyAudio && this.legacyDevice) {
      try {
        this.ffmpegProcess = spawnFfmpeg(this.legacyDevice.index);
      } catch (error) {
        this.isRecording = false;
        this.events.emit("status", `ffmpeg error: ${toReadableError(error)}`);
        return;
      }

      if (!this.ffmpegProcess.stdout) {
        this.isRecording = false;
        this.events.emit("status", "ffmpeg failed");
        return;
      }

      this.ffmpegProcess.stdout.on("data", (data: Buffer) => {
        this.handleAudioData(data);
      });

      this.ffmpegProcess.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          log("WARN", `ffmpeg stderr: ${msg}`);
          this.events.emit("status", `ffmpeg: ${msg.slice(0, 80)}`);
        }
      });

      this.ffmpegProcess.on("error", (err) => {
        log("ERROR", `ffmpeg error: ${err.message}`);
        this.events.emit("status", `ffmpeg error: ${err.message}`);
      });

      this.ffmpegProcess.on("close", (code, signal) => {
        log("WARN", `ffmpeg closed: code=${code} signal=${signal}`);
        if (code !== 0 && code !== null && this.isRecording) {
          const msg = `ffmpeg exited with code ${code}`;
          log("ERROR", msg);
          this.events.emit("error", msg);
        }
      });
    } else {
      try {
        this.audioRecorder = createAudioRecorder(16000);
        this.audioRecorder.on("data", (data) => {
          this.handleAudioData(data as Buffer);
        });
        this.audioRecorder.on("error", (err) => {
          const error = err as Error;
          log("ERROR", `Audio capture error: ${error.message}`);
          this.events.emit("status", `Audio error: ${error.message}`);
        });
        await this.audioRecorder.start();
      } catch (error) {
        this.isRecording = false;
        const msg = toReadableError(error);
        log("ERROR", `ScreenCaptureKit error: ${msg}`);
        this.events.emit("status", `Audio capture error: ${msg}`);
        return;
      }
    }

    this.startSummaryTimer();
  }

  stopRecording(): void {
    if (!this.isRecording) return;
    this.isRecording = false;

    this.stopSummaryTimer();

    if (this.audioRecorder) {
      this.audioRecorder.stop();
      this.audioRecorder = null;
    }
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill("SIGTERM");
      this.ffmpegProcess = null;
    }

    const remaining = flushVad(this.vadState);
    if (remaining) {
      this.enqueueVertexChunk(remaining);
      void this.processVertexQueue();
    }

    this.vertexChunkQueue = [];
    this.vertexOverlap = Buffer.alloc(0);
    this.vertexInFlight = 0;
    resetVadState(this.vadState);

    this.events.emit("state-change", this.getUIState("paused"));
    this.events.emit("status", "Paused. SPACE to resume, Q to quit.");
  }

  shutdown(): void {
    log("INFO", "Session shutdown");
    if (this.isRecording) this.stopRecording();
    writeSummaryLog(this.contextState.allKeyPoints);
  }

  private handleAudioData(data: Buffer) {
    const chunks = processAudioData(this.vadState, data);
    for (const chunk of chunks) {
      this.enqueueVertexChunk(chunk);
      void this.processVertexQueue();
    }
  }

  private enqueueVertexChunk(chunk: Buffer) {
    if (!chunk.length) return;
    const overlapBytes = Math.floor(16000 * 2 * 0.5);
    const overlap = this.vertexOverlap.subarray(0, overlapBytes);
    const combined = overlap.length ? Buffer.concat([overlap, chunk]) : chunk;

    while (this.vertexChunkQueue.length >= this.vertexMaxQueueSize) {
      this.vertexChunkQueue.shift();
      log("WARN", `Dropped oldest chunk, queue was at ${this.vertexMaxQueueSize}`);
    }

    this.vertexChunkQueue.push(combined);
    this.vertexOverlap = Buffer.from(
      chunk.subarray(Math.max(0, chunk.length - overlapBytes))
    );
  }

  private updateInFlightDisplay() {
    if (this.vertexInFlight > 0) {
      this.events.emit("status", `Processing ${this.vertexInFlight} chunk${this.vertexInFlight > 1 ? "s" : ""}...`);
    } else if (this.isRecording) {
      this.events.emit("status", "Listening...");
    }
  }

  private async processVertexQueue(): Promise<void> {
    if (this.vertexInFlight >= this.vertexMaxConcurrency || this.vertexChunkQueue.length === 0) return;
    const chunk = this.vertexChunkQueue.shift();
    if (!chunk) return;
    this.vertexInFlight++;

    const startTime = Date.now();
    const chunkDurationMs = (chunk.length / (16000 * 2)) * 1000;
    this.updateInFlightDisplay();

    try {
      const prompt = buildAudioPromptForStructured(
        this.config.direction,
        this.config.sourceLang,
        this.config.targetLang,
        getContextWindow(this.contextState),
        this.contextState.allKeyPoints.slice(-8)
      );
      const wavBuffer = pcmToWavBuffer(chunk, 16000);

      if (this.config.debug) {
        log("INFO", `Vertex request: chunk=${chunkDurationMs.toFixed(0)}ms (${(wavBuffer.byteLength / 1024).toFixed(0)}KB), queue=${this.vertexChunkQueue.length}, inflight=${this.vertexInFlight}`);
      }

      const { object: result, usage: finalUsage } = await generateObject({
        model: this.vertexModel,
        schema: this.audioTranscriptionSchema,
        system: this.userContext || undefined,
        temperature: 0,
        maxRetries: 2,
        abortSignal: AbortSignal.timeout(30000),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "file",
                mediaType: "audio/wav",
                data: wavBuffer,
              },
            ],
          },
        ],
      });

      const elapsed = Date.now() - startTime;
      const inTok = finalUsage?.inputTokens ?? 0;
      const outTok = finalUsage?.outputTokens ?? 0;
      const totalCost = addCostToAcc(this.costAccumulator, inTok, outTok, "audio");
      this.events.emit("cost-updated", totalCost);

      if (this.config.debug) {
        log("INFO", `Vertex response: ${elapsed}ms, tokens: ${inTok}\u2192${outTok}, queue: ${this.vertexChunkQueue.length}`);
        this.events.emit("status", `Response: ${elapsed}ms | T: ${inTok}\u2192${outTok}`);
      }

      const transcript = (result as { transcript?: string }).transcript?.trim() ?? "";
      const translation = (result as { translation?: string }).translation?.trim() ?? "";
      const detectedLang = (result as { sourceLanguage: string }).sourceLanguage as LanguageCode;

      if (!translation && !transcript) {
        log("WARN", "Vertex returned empty transcript and translation");
        return;
      }

      const sourceText = transcript || "(unavailable)";
      const isTargetLang = detectedLang === this.config.targetLang;
      const detectedLabel = getLanguageLabel(detectedLang);
      const translatedToLabel = isTargetLang ? this.sourceLangLabel : this.targetLangLabel;

      const block = createBlock(this.contextState, detectedLabel, sourceText, translatedToLabel, translation || undefined);
      this.events.emit("block-added", block);

      block.partial = (result as { isPartial: boolean }).isPartial;
      block.newTopic = (result as { isNewTopic: boolean }).isNewTopic;
      this.events.emit("block-updated", block);

      if (sourceText && hasTranslatableContent(sourceText)) {
        recordContext(this.contextState, sourceText);
      } else if (translation && hasTranslatableContent(translation)) {
        recordContext(this.contextState, translation);
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const isAbortError =
        (error instanceof Error && error.name === "AbortError") ||
        (error && typeof error === "object" && "name" in error && (error as { name: string }).name === "AbortError");
      const isTimeout =
        isAbortError ||
        (error instanceof Error && error.name === "TimeoutError");
      const errorMsg = isTimeout ? `Timed out (${(elapsed / 1000).toFixed(1)}s)` : toReadableError(error);
      const fullError = error instanceof Error
        ? `${error.name}: ${error.message}${error.cause ? ` cause=${JSON.stringify(error.cause)}` : ""}`
        : toReadableError(error);
      log("ERROR", `Vertex chunk failed after ${elapsed}ms (audio=${chunkDurationMs.toFixed(0)}ms): ${fullError}`);
      this.events.emit("status", `\u26A0 ${errorMsg}`);
    } finally {
      this.vertexInFlight--;
      this.updateInFlightDisplay();
      if (this.vertexChunkQueue.length && this.vertexInFlight < this.vertexMaxConcurrency) {
        void this.processVertexQueue();
      }
    }
  }

  private startSummaryTimer() {
    if (this.summaryTimer) clearInterval(this.summaryTimer);
    this.summaryTimer = setInterval(() => {
      if (!this.isRecording) return;
      void this.generateSummary();
    }, 30000);
  }

  private stopSummaryTimer() {
    if (this.summaryTimer) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = null;
    }
  }

  private async generateSummary(): Promise<void> {
    if (this.summaryInFlight) return;

    const windowStart = Date.now() - 30000;
    const recentBlocks = [...this.contextState.transcriptBlocks.values()].filter(
      (b) => b.createdAt >= windowStart
    );
    if (recentBlocks.length < 2) return;

    this.summaryInFlight = true;
    const startTime = Date.now();
    try {
      const text = recentBlocks
        .map((b) => `${b.sourceLabel}: ${b.sourceText}${b.translation ? ` \u2192 ${b.targetLabel}: ${b.translation}` : ""}`)
        .join("\n");

      const { object: summaryResult, usage: summaryUsage } = await generateObject({
        model: this.vertexModel,
        schema: this.summarySchema,
        prompt: `Summarize this conversation in exactly 4 bullets:\n\n${text}`,
        abortSignal: AbortSignal.timeout(10000),
        temperature: 0,
      });

      const elapsed = Date.now() - startTime;
      const totalCost = addCostToAcc(
        this.costAccumulator,
        summaryUsage?.inputTokens ?? 0,
        summaryUsage?.outputTokens ?? 0,
        "text"
      );
      this.events.emit("cost-updated", totalCost);

      if (this.config.debug) {
        log("INFO", `Summary response: ${elapsed}ms`);
      }

      const keyPoints = (summaryResult as { keyPoints: string[] }).keyPoints;
      this.contextState.allKeyPoints.push(...keyPoints);

      this.lastSummary = {
        keyPoints,
        updatedAt: Date.now(),
      };
      this.events.emit("summary-updated", this.lastSummary);
    } catch {
      // Silent fail for summary generation
    } finally {
      this.summaryInFlight = false;
    }
  }
}
