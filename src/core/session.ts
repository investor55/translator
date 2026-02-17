import { EventEmitter } from "node:events";
import { type ChildProcess } from "node:child_process";
import { generateObject } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";
import { z } from "zod";

import type {
  Agent,
  AudioSource,
  SessionConfig,
  SessionEvents,
  Summary,
  UIState,
  LanguageCode,
  TodoItem,
  TodoSuggestion,
  Insight,
} from "./types";
import { log } from "./logger";
import { pcmToWavBuffer, computeRms } from "./audio-utils";
import { toReadableError } from "./text-utils";
import { analysisSchema, buildAnalysisPrompt } from "./analysis";
import type { AppDatabase } from "./db";
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
  spawnMicFfmpeg,
  type AudioRecorder,
} from "./audio";
import { createAgentManager, type AgentManager } from "./agent-manager";

type TypedEmitter = EventEmitter & {
  emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean;
  on<K extends keyof SessionEvents>(event: K, listener: (...args: SessionEvents[K]) => void): TypedEmitter;
};

type AudioPipeline = {
  source: AudioSource;
  vadState: VadState;
  overlap: Buffer;
};

export class Session {
  readonly events: TypedEmitter = new EventEmitter() as TypedEmitter;
  readonly config: SessionConfig;
  readonly sessionId: string;

  private vertexModel: ReturnType<ReturnType<typeof createVertex>>;
  private analysisModel: ReturnType<ReturnType<typeof createVertex>>;
  private audioTranscriptionSchema: z.ZodObject<z.ZodRawShape>;
  private transcriptionOnlySchema: z.ZodObject<z.ZodRawShape>;

  private isRecording = false;
  private audioRecorder: AudioRecorder | null = null;
  private ffmpegProcess: ReturnType<typeof spawnFfmpeg> | null = null;
  private legacyDevice: { index: number; name: string } | null = null;

  // Mic pipeline
  private micProcess: ChildProcess | null = null;
  private _micEnabled = false;

  // Shared Vertex queue for both pipelines
  private vertexChunkQueue: Array<{ chunk: Buffer; audioSource: AudioSource }> = [];
  private vertexInFlight = 0;
  private vertexMaxConcurrency = 5;
  private readonly vertexMaxQueueSize = 20;

  // Per-pipeline state
  private systemPipeline: AudioPipeline = {
    source: "system",
    vadState: createVadState(),
    overlap: Buffer.alloc(0),
  };
  private micPipeline: AudioPipeline = {
    source: "microphone",
    vadState: createVadState(200),
    overlap: Buffer.alloc(0),
  };

  private contextState: ContextState = createContextState();
  private costAccumulator: CostAccumulator = createCostAccumulator();
  private userContext: string;
  private _translationEnabled: boolean;

  private analysisTimer: NodeJS.Timeout | null = null;
  private analysisInFlight = false;
  private lastSummary: Summary | null = null;
  private lastAnalysisBlockCount = 0;
  private db: AppDatabase | null;
  private agentManager: AgentManager | null = null;

  private sourceLangLabel: string;
  private targetLangLabel: string;
  private sourceLangName: string;
  private targetLangName: string;

  constructor(config: SessionConfig, db?: AppDatabase) {
    this.config = config;
    this.db = db ?? null;
    this.sessionId = crypto.randomUUID();
    this._translationEnabled = config.translationEnabled;
    this.userContext = loadUserContext(config.contextFile, config.useContext);

    const vertex = createVertex({
      project: config.vertexProject,
      location: config.vertexLocation,
    });
    this.vertexModel = vertex(config.vertexModelId);
    this.analysisModel = vertex(config.vertexModelId);

    const exaApiKey = process.env.EXA_API_KEY;
    if (exaApiKey) {
      this.agentManager = createAgentManager({
        model: this.analysisModel,
        exaApiKey,
        events: this.events,
        getTranscriptContext: () => this.getTranscriptContextForAgent(),
      });
      log("INFO", "AgentManager initialized (EXA_API_KEY present)");
    }

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

    this.transcriptionOnlySchema = z.object({
      sourceLanguage: z
        .enum(langEnumValues)
        .describe(`The detected language: ${langEnumValues.map((c) => `"${c}" for ${LANG_NAMES[c as LanguageCode] ?? c}`).join(", ")}`),
      transcript: z
        .string()
        .describe("The transcription of the audio in the original language"),
      isPartial: z
        .boolean()
        .describe("True if the audio was cut off mid-sentence. False if speech ends at a natural boundary."),
      isNewTopic: z
        .boolean()
        .describe("True if the speaker shifted to a new topic. False if continuing the same topic."),
    });

  }

  getUIState(status: UIState["status"]): UIState {
    const langPair = `${this.sourceLangName} → ${this.targetLangName}`;
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
      translationEnabled: this._translationEnabled,
      micEnabled: this._micEnabled,
    };
  }

  get recording(): boolean {
    return this.isRecording;
  }

  get allKeyPoints(): readonly string[] {
    return this.contextState.allKeyPoints;
  }

  get translationEnabled(): boolean {
    return this._translationEnabled;
  }

  get micEnabled(): boolean {
    return this._micEnabled;
  }

  async initialize(): Promise<void> {
    // Seed context with recent key points from previous sessions
    if (this.db) {
      const previousKeyPoints = this.db.getRecentKeyPoints(20);
      if (previousKeyPoints.length > 0) {
        this.contextState.allKeyPoints.push(...previousKeyPoints);
        log("INFO", `Loaded ${previousKeyPoints.length} key points from previous sessions`);
      }
    }

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

    resetVadState(this.systemPipeline.vadState);
    resetContextState(this.contextState);
    resetCost(this.costAccumulator);
    this.vertexChunkQueue = [];
    this.systemPipeline.overlap = Buffer.alloc(0);
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
        this.handleAudioData(this.systemPipeline, data);
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
          this.handleAudioData(this.systemPipeline, data as Buffer);
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

    this.startAnalysisTimer();
  }

  stopRecording(): void {
    if (!this.isRecording) return;
    this.isRecording = false;

    this.stopAnalysisTimer();

    if (this.audioRecorder) {
      this.audioRecorder.stop();
      this.audioRecorder = null;
    }
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill("SIGTERM");
      this.ffmpegProcess = null;
    }

    // Flush system pipeline
    const remaining = flushVad(this.systemPipeline.vadState);
    if (remaining) {
      this.enqueueVertexChunk(this.systemPipeline, remaining);
      void this.processVertexQueue();
    }

    // Flush mic pipeline if active
    if (this._micEnabled) {
      this.stopMic();
    }

    this.vertexChunkQueue = [];
    this.systemPipeline.overlap = Buffer.alloc(0);
    this.vertexInFlight = 0;
    resetVadState(this.systemPipeline.vadState);

    this.events.emit("state-change", this.getUIState("paused"));
    this.events.emit("status", "Paused. SPACE to resume, Q to quit.");
  }

  startMic(deviceIdentifier?: string): void {
    if (this._micEnabled) return;

    const device = deviceIdentifier ?? this.config.micDevice ?? "0";
    let micStderrBuffer = "";

    try {
      this.micProcess = spawnMicFfmpeg(device);
      this._micEnabled = true;
      resetVadState(this.micPipeline.vadState);
      this.micPipeline.overlap = Buffer.alloc(0);

      // Raise concurrency when both pipelines active
      this.vertexMaxConcurrency = 8;

      let micDataReceived = false;
      let micTotalBytes = 0;
      let micNonZeroSeen = false;

      this.micProcess.stdout?.on("data", (data: Buffer) => {
        if (!micDataReceived) {
          micDataReceived = true;
          log("INFO", `Mic: receiving audio data`);
          this.events.emit("status", "Mic active — listening...");
        }

        // Detect all-zero audio (TCC permission issue)
        if (!micNonZeroSeen) {
          micTotalBytes += data.length;
          const hasNonZero = data.some((b) => b !== 0);
          if (hasNonZero) {
            micNonZeroSeen = true;
            log("INFO", "Mic: non-zero audio detected — signal OK");
          } else if (micTotalBytes > 16000 * 2 * 3) {
            // 3 seconds of pure zeros — almost certainly a permissions issue
            log("WARN", `Mic: ${micTotalBytes} bytes received, all zeros — likely macOS mic permission issue`);
            this.events.emit("error", "Mic producing silent audio. macOS may be blocking mic access for ffmpeg. Check System Settings > Privacy & Security > Microphone.");
            this.events.emit("status", "Mic: all zeros — permission issue?");
            micNonZeroSeen = true; // stop re-warning
          }
        }

        this.handleAudioData(this.micPipeline, data);
      });

      this.micProcess.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          micStderrBuffer += msg + "\n";
          log("INFO", `mic ffmpeg: ${msg}`);
        }
      });

      this.micProcess.on("error", (err) => {
        log("ERROR", `Mic ffmpeg error: ${err.message}`);
        this._micEnabled = false;
        this.events.emit("error", `Mic failed: ${err.message}`);
        this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
      });

      this.micProcess.on("close", (code) => {
        if (this._micEnabled) {
          this._micEnabled = false;
          this.vertexMaxConcurrency = 5;
          if (code !== 0 && code !== null) {
            const detail = micStderrBuffer.trim().slice(-200) || `exit code ${code}`;
            log("ERROR", `Mic ffmpeg exited: code=${code}, stderr: ${micStderrBuffer.trim()}`);
            this.events.emit("error", `Mic stopped unexpectedly: ${detail}`);
          }
          this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
        }
      });

      log("INFO", `Mic started: device=${device}, cmd: ffmpeg -loglevel info -f avfoundation -thread_queue_size 1024 -i none:${device} -ac 1 -ar 16000 -f s16le -acodec pcm_s16le -nostdin -`);
      this.events.emit("status", "Starting microphone...");
      this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "idle"));
    } catch (error) {
      this._micEnabled = false;
      log("ERROR", `Failed to start mic: ${toReadableError(error)}`);
      this.events.emit("error", `Mic error: ${toReadableError(error)}`);
    }
  }

  /** Start mic pipeline without ffmpeg — audio will be fed via feedMicAudio from renderer */
  startMicFromIPC(): void {
    if (this._micEnabled) return;

    this._micEnabled = true;
    resetVadState(this.micPipeline.vadState);
    this.micPipeline.overlap = Buffer.alloc(0);
    this.vertexMaxConcurrency = 8;
    this.micDebugWindowCount = 0;

    log("INFO", "Mic started via renderer capture (Web Audio API)");
    this.events.emit("status", "Mic active — listening...");
    this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "idle"));
  }

  /** Receive PCM audio from renderer IPC */
  feedMicAudio(data: Buffer): void {
    if (!this._micEnabled) return;
    this.handleAudioData(this.micPipeline, data);
  }

  stopMic(): void {
    if (!this._micEnabled) return;

    const remaining = flushVad(this.micPipeline.vadState);
    if (remaining) {
      this.enqueueVertexChunk(this.micPipeline, remaining);
      void this.processVertexQueue();
    }

    if (this.micProcess) {
      this.micProcess.kill("SIGTERM");
      this.micProcess = null;
    }

    this._micEnabled = false;
    this.vertexMaxConcurrency = 5;
    resetVadState(this.micPipeline.vadState);
    this.micPipeline.overlap = Buffer.alloc(0);

    log("INFO", "Mic stopped");
    this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
  }

  toggleTranslation(): boolean {
    this._translationEnabled = !this._translationEnabled;
    this.events.emit("state-change", this.getUIState(
      this.isRecording ? "recording" : this.isRecording ? "connecting" : "idle"
    ));
    log("INFO", `Translation ${this._translationEnabled ? "enabled" : "disabled"}`);
    return this._translationEnabled;
  }

  shutdown(): void {
    log("INFO", "Session shutdown");
    if (this._micEnabled) this.stopMic();
    if (this.isRecording) this.stopRecording();
    writeSummaryLog(this.contextState.allKeyPoints);
  }

  launchAgent(todoId: string, task: string): Agent | null {
    if (!this.agentManager) return null;
    return this.agentManager.launchAgent(todoId, task, this.sessionId);
  }

  getAgents(): Agent[] {
    return this.agentManager?.getAllAgents() ?? [];
  }

  private getTranscriptContextForAgent(): string {
    const blocks = [...this.contextState.transcriptBlocks.values()].slice(-20);
    if (blocks.length === 0) return "(No transcript yet)";
    return blocks
      .map((b) => {
        const src = `[${b.audioSource}] ${b.sourceText}`;
        const translation = b.translation ? ` → ${b.translation}` : "";
        return src + translation;
      })
      .join("\n");
  }

  private micDebugWindowCount = 0;

  private handleAudioData(pipeline: AudioPipeline, data: Buffer) {
    const chunks = processAudioData(pipeline.vadState, data);

    // Periodic mic level reporting (~every 2s of audio = 20 × 100ms windows)
    if (pipeline.source === "microphone") {
      const prev = this.micDebugWindowCount;
      this.micDebugWindowCount = pipeline.vadState.windowCount;
      if (Math.floor(this.micDebugWindowCount / 20) > Math.floor(prev / 20)) {
        const { peakRms, silenceThreshold, speechStarted } = pipeline.vadState;
        const speechBufMs = (pipeline.vadState.speechBuffer.length / (16000 * 2)) * 1000;
        log("INFO", `Mic levels: peakRms=${peakRms.toFixed(0)} threshold=${silenceThreshold} speechStarted=${speechStarted} speechBuf=${speechBufMs.toFixed(0)}ms queue=${this.vertexChunkQueue.length}`);
        this.events.emit("status", `Mic: peak=${peakRms.toFixed(0)} thr=${silenceThreshold}${speechStarted ? ` speaking ${speechBufMs.toFixed(0)}ms` : ""}`);
        pipeline.vadState.peakRms = 0;
      }
    }

    for (const chunk of chunks) {
      const durationMs = (chunk.length / (16000 * 2)) * 1000;

      if (pipeline.source === "microphone") {
        log("INFO", `Mic VAD: speech chunk ${durationMs.toFixed(0)}ms rms=${computeRms(chunk).toFixed(0)}, queue=${this.vertexChunkQueue.length}`);
      }

      this.enqueueVertexChunk(pipeline, chunk);
      void this.processVertexQueue();
    }
  }

  private enqueueVertexChunk(pipeline: AudioPipeline, chunk: Buffer) {
    if (!chunk.length) return;
    const overlapBytes = Math.floor(16000 * 2 * 0.5);
    const overlap = pipeline.overlap.subarray(0, overlapBytes);
    const combined = overlap.length ? Buffer.concat([overlap, chunk]) : chunk;

    while (this.vertexChunkQueue.length >= this.vertexMaxQueueSize) {
      this.vertexChunkQueue.shift();
      log("WARN", `Dropped oldest chunk, queue was at ${this.vertexMaxQueueSize}`);
    }

    this.vertexChunkQueue.push({ chunk: combined, audioSource: pipeline.source });
    pipeline.overlap = Buffer.from(
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
    const item = this.vertexChunkQueue.shift();
    if (!item) return;
    const { chunk, audioSource } = item;
    this.vertexInFlight++;

    const startTime = Date.now();
    const chunkDurationMs = (chunk.length / (16000 * 2)) * 1000;
    this.updateInFlightDisplay();

    const useTranslation = this._translationEnabled;
    const schema = useTranslation ? this.audioTranscriptionSchema : this.transcriptionOnlySchema;

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
        log("INFO", `Vertex request: src=${audioSource} chunk=${chunkDurationMs.toFixed(0)}ms (${(wavBuffer.byteLength / 1024).toFixed(0)}KB), queue=${this.vertexChunkQueue.length}, inflight=${this.vertexInFlight}`);
      }

      const { object: result, usage: finalUsage } = await generateObject({
        model: this.vertexModel,
        schema,
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
        log("INFO", `Vertex response: ${elapsed}ms, tokens: ${inTok}→${outTok}, queue: ${this.vertexChunkQueue.length}`);
        this.events.emit("status", `Response: ${elapsed}ms | T: ${inTok}→${outTok}`);
      }

      const transcript = (result as { transcript?: string }).transcript?.trim() ?? "";
      const translation = useTranslation
        ? ((result as { translation?: string }).translation?.trim() ?? "")
        : "";
      const detectedLang = (result as { sourceLanguage: string }).sourceLanguage as LanguageCode;

      if (!translation && !transcript) {
        log("WARN", "Vertex returned empty transcript and translation");
        return;
      }

      const sourceText = transcript || "(unavailable)";
      const isTargetLang = detectedLang === this.config.targetLang;
      const detectedLabel = getLanguageLabel(detectedLang);
      const translatedToLabel = isTargetLang ? this.sourceLangLabel : this.targetLangLabel;

      const block = createBlock(
        this.contextState,
        detectedLabel,
        sourceText,
        translatedToLabel,
        translation || undefined,
        audioSource
      );
      block.sessionId = this.sessionId;
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
      this.events.emit("status", `⚠ ${errorMsg}`);
    } finally {
      this.vertexInFlight--;
      this.updateInFlightDisplay();
      if (this.vertexChunkQueue.length && this.vertexInFlight < this.vertexMaxConcurrency) {
        void this.processVertexQueue();
      }
    }
  }

  private startAnalysisTimer() {
    if (this.analysisTimer) clearInterval(this.analysisTimer);
    this.analysisTimer = setInterval(() => {
      if (!this.isRecording) return;
      void this.generateAnalysis();
    }, 30000);
  }

  private stopAnalysisTimer() {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
  }

  private async generateAnalysis(): Promise<void> {
    if (this.analysisInFlight) return;

    const allBlocks = [...this.contextState.transcriptBlocks.values()];
    if (allBlocks.length <= this.lastAnalysisBlockCount) return;

    const windowStart = Date.now() - 60000;
    const recentBlocks = allBlocks.filter((b) => b.createdAt >= windowStart);
    if (recentBlocks.length < 2) return;

    this.analysisInFlight = true;
    this.lastAnalysisBlockCount = allBlocks.length;
    const startTime = Date.now();

    try {
      const existingTodos = this.db ? this.db.getTodos() : [];
      const previousKeyPoints = this.contextState.allKeyPoints.slice(-20);

      const prompt = buildAnalysisPrompt(recentBlocks, existingTodos, previousKeyPoints);

      const { object: result, usage } = await generateObject({
        model: this.analysisModel,
        schema: analysisSchema,
        prompt,
        abortSignal: AbortSignal.timeout(30000),
        temperature: 0,
        providerOptions: {
          google: {
            thinkingConfig: {
              includeThoughts: false,
              thinkingBudget: 2048,
            },
          },
        },
      });

      const elapsed = Date.now() - startTime;
      const totalCost = addCostToAcc(
        this.costAccumulator,
        usage?.inputTokens ?? 0,
        usage?.outputTokens ?? 0,
        "text"
      );
      this.events.emit("cost-updated", totalCost);

      if (this.config.debug) {
        log("INFO", `Analysis response: ${elapsed}ms, keyPoints=${result.keyPoints.length}, insights=${result.educationalInsights.length}, todos=${result.suggestedTodos.length}`);
      }

      // Update key points / summary — persist each as an insight so history survives
      this.contextState.allKeyPoints.push(...result.keyPoints);
      for (const text of result.keyPoints) {
        const kpInsight: Insight = {
          id: crypto.randomUUID(),
          kind: "key-point",
          text,
          sessionId: this.sessionId,
          createdAt: Date.now(),
        };
        this.db?.insertInsight(kpInsight);
      }
      this.lastSummary = { keyPoints: result.keyPoints, updatedAt: Date.now() };
      this.events.emit("summary-updated", this.lastSummary);

      // Emit educational insights
      for (const item of result.educationalInsights) {
        const insight: Insight = {
          id: crypto.randomUUID(),
          kind: item.kind,
          text: item.text,
          sessionId: this.sessionId,
          createdAt: Date.now(),
        };
        this.db?.insertInsight(insight);
        this.events.emit("insight-added", insight);
      }

      // Emit todo suggestions (not auto-added — user must accept)
      for (const text of result.suggestedTodos) {
        const suggestion: TodoSuggestion = {
          id: crypto.randomUUID(),
          text,
          sessionId: this.sessionId,
          createdAt: Date.now(),
        };
        this.events.emit("todo-suggested", suggestion);
      }
    } catch (error) {
      if (this.config.debug) {
        log("WARN", `Analysis failed: ${toReadableError(error)}`);
      }
    } finally {
      this.analysisInFlight = false;
    }
  }
}
