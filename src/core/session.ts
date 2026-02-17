import { EventEmitter } from "node:events";
import { type ChildProcess } from "node:child_process";
import { generateObject, type LanguageModel } from "ai";
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
import { createTranscriptionModel, createAnalysisModel, createTodoModel } from "./providers";
import { log } from "./logger";
import { pcmToWavBuffer, computeRms } from "./audio-utils";
import { isLikelyDuplicateTodoText, normalizeTodoText, toReadableError } from "./text-utils";
import { analysisSchema, todoAnalysisSchema, buildAnalysisPrompt, buildTodoPrompt } from "./analysis";
import type { AppDatabase } from "./db";
import {
  LANG_NAMES,
  getLanguageLabel,
  hasTranslatableContent,
  buildAudioPromptForStructured,
  detectSourceLanguage,
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
import { transcribeWithElevenLabs } from "./elevenlabs";

type TypedEmitter = EventEmitter & {
  emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean;
  on<K extends keyof SessionEvents>(event: K, listener: (...args: SessionEvents[K]) => void): TypedEmitter;
};

type AudioPipeline = {
  source: AudioSource;
  vadState: VadState;
  overlap: Buffer;
};

type PendingFastTodo = {
  text: string;
  createdAt: number;
  flushAfterMs: number;
};

type FastTodoTriggerType = "explicit" | "implicit";

export class Session {
  readonly events: TypedEmitter = new EventEmitter() as TypedEmitter;
  readonly config: SessionConfig;
  readonly sessionId: string;

  private transcriptionModel: LanguageModel | null;
  private analysisModel: LanguageModel;
  private todoModel: LanguageModel;
  private audioTranscriptionSchema: z.ZodObject<z.ZodRawShape>;
  private transcriptionOnlySchema: z.ZodObject<z.ZodRawShape>;
  private textPostProcessSchema: z.ZodObject<z.ZodRawShape>;

  private isRecording = false;
  private audioRecorder: AudioRecorder | null = null;
  private ffmpegProcess: ReturnType<typeof spawnFfmpeg> | null = null;
  private legacyDevice: { index: number; name: string } | null = null;

  // Mic pipeline
  private micProcess: ChildProcess | null = null;
  private _micEnabled = false;

  // Shared transcription queue for both pipelines. Keep sequential to preserve speech order.
  private chunkQueue: Array<{
    chunk: Buffer;
    audioSource: AudioSource;
    capturedAt: number;
  }> = [];
  private inFlight = 0;
  private maxConcurrency = 1;
  private readonly maxQueueSize = 20;

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
  private analysisHeartbeatTimer: NodeJS.Timeout | null = null;
  private analysisInFlight = false;
  private analysisRequested = false;
  private readonly analysisDebounceMs = 300;
  private readonly analysisHeartbeatMs = 5000;
  private readonly analysisRetryDelayMs = 2000;
  private recentSuggestedTodoTexts: string[] = [];
  private pendingFastTodo: PendingFastTodo | null = null;
  private pendingFastTodoTimer: NodeJS.Timeout | null = null;
  private lastFastTodoCandidate: { text: string; createdAt: number } | null = null;
  private readonly fastTodoContinuationWindowMs = 3500;
  private readonly fastTodoImplicitHoldMs = 1400;
  private readonly fastTodoReferenceWindowMs = 90000;
  private lastSummary: Summary | null = null;
  private lastAnalysisBlockCount = 0;
  private db: AppDatabase | null;
  private agentManager: AgentManager | null = null;

  private sourceLangLabel: string;
  private targetLangLabel: string;
  private sourceLangName: string;
  private targetLangName: string;

  constructor(config: SessionConfig, db?: AppDatabase, sessionId?: string) {
    this.config = config;
    this.db = db ?? null;
    this.sessionId = sessionId ?? crypto.randomUUID();
    this._translationEnabled = config.translationEnabled;
    this.userContext = loadUserContext(config.contextFile, config.useContext);

    this.transcriptionModel = config.transcriptionProvider === "elevenlabs"
      ? null
      : createTranscriptionModel(config);
    this.analysisModel = createAnalysisModel(config);
    this.todoModel = createTodoModel(config);

    const exaApiKey = process.env.EXA_API_KEY;
    if (exaApiKey) {
      this.agentManager = createAgentManager({
        model: this.analysisModel,
        exaApiKey,
        events: this.events,
        getTranscriptContext: () => this.getTranscriptContextForAgent(),
        db: this.db ?? undefined,
      });
      if (this.db) {
        const persistedAgents = this.db.getAgentsForSession(this.sessionId);
        if (persistedAgents.length > 0) {
          this.agentManager.hydrateAgents(persistedAgents);
        }
      }
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

    const sourceLanguageDescription = `The detected language: ${langEnumValues.map((c) => `"${c}" for ${LANG_NAMES[c as LanguageCode] ?? c}`).join(", ")}`;

    this.audioTranscriptionSchema = z.object({
      sourceLanguage: z
        .enum(langEnumValues)
        .describe(sourceLanguageDescription),
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
        .describe(sourceLanguageDescription),
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

    this.textPostProcessSchema = z.object({
      sourceLanguage: z
        .enum(langEnumValues)
        .describe(sourceLanguageDescription),
      translation: z
        .string()
        .optional()
        .describe("Translated text based on configured language direction. Empty when translation is disabled or not needed."),
      isPartial: z
        .boolean()
        .describe("True if the transcript appears cut off mid-sentence. False if it appears complete."),
      isNewTopic: z
        .boolean()
        .describe("True if the transcript shifts to a new topic compared with provided context."),
    });

  }

  getUIState(status: UIState["status"]): UIState {
    const langPair = `${this.sourceLangName} → ${this.targetLangName}`;
    const deviceName = this.config.legacyAudio && this.legacyDevice
      ? this.legacyDevice.name
      : "System Audio (ScreenCaptureKit)";
    return {
      deviceName,
      modelId: `${langPair} | ${this.config.transcriptionModelId}`,
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

  async startRecording(resume = false): Promise<void> {
    if (this.isRecording) return;
    this.isRecording = true;

    resetVadState(this.systemPipeline.vadState);
    this.chunkQueue = [];
    this.systemPipeline.overlap = Buffer.alloc(0);
    this.inFlight = 0;

    if (!resume) {
      resetContextState(this.contextState);
      resetCost(this.costAccumulator);
      this.lastSummary = null;
      this.lastAnalysisBlockCount = 0;
      this.recentSuggestedTodoTexts = [];
      this.pendingFastTodo = null;
      this.lastFastTodoCandidate = null;
      this.events.emit("blocks-cleared");
      this.events.emit("summary-updated", null);
    }

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
      this.enqueueChunk(this.systemPipeline, remaining);
      void this.processQueue();
    }

    // Flush mic pipeline if active
    if (this._micEnabled) {
      this.stopMic();
    }

    this.chunkQueue = [];
    this.systemPipeline.overlap = Buffer.alloc(0);
    this.inFlight = 0;
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

      // Keep sequential processing so transcript order matches speech order.
      this.maxConcurrency = 1;

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
          this.maxConcurrency = 1;
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
    this.maxConcurrency = 1;
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
      this.enqueueChunk(this.micPipeline, remaining);
      void this.processQueue();
    }

    if (this.micProcess) {
      this.micProcess.kill("SIGTERM");
      this.micProcess = null;
    }

    this._micEnabled = false;
    this.maxConcurrency = 1;
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

  followUpAgent(agentId: string, question: string): boolean {
    return this.agentManager?.followUpAgent(agentId, question) ?? false;
  }

  cancelAgent(agentId: string): boolean {
    return this.agentManager?.cancelAgent(agentId) ?? false;
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
        log("INFO", `Mic levels: peakRms=${peakRms.toFixed(0)} threshold=${silenceThreshold} speechStarted=${speechStarted} speechBuf=${speechBufMs.toFixed(0)}ms queue=${this.chunkQueue.length}`);
        this.events.emit("status", `Mic: peak=${peakRms.toFixed(0)} thr=${silenceThreshold}${speechStarted ? ` speaking ${speechBufMs.toFixed(0)}ms` : ""}`);
        pipeline.vadState.peakRms = 0;
      }
    }

    for (const chunk of chunks) {
      const durationMs = (chunk.length / (16000 * 2)) * 1000;

      if (pipeline.source === "microphone") {
        log("INFO", `Mic VAD: speech chunk ${durationMs.toFixed(0)}ms rms=${computeRms(chunk).toFixed(0)}, queue=${this.chunkQueue.length}`);
      }

      this.enqueueChunk(pipeline, chunk);
      void this.processQueue();
    }
  }

  private enqueueChunk(pipeline: AudioPipeline, chunk: Buffer) {
    if (!chunk.length) return;
    const overlapBytes = Math.floor(16000 * 2 * 0.5);
    const overlap = pipeline.overlap.subarray(0, overlapBytes);
    const combined = overlap.length ? Buffer.concat([overlap, chunk]) : chunk;

    while (this.chunkQueue.length >= this.maxQueueSize) {
      this.chunkQueue.shift();
      log("WARN", `Dropped oldest chunk, queue was at ${this.maxQueueSize}`);
    }

    this.chunkQueue.push({
      chunk: combined,
      audioSource: pipeline.source,
      capturedAt: Date.now(),
    });
    pipeline.overlap = Buffer.from(
      chunk.subarray(Math.max(0, chunk.length - overlapBytes))
    );
  }

  private updateInFlightDisplay() {
    if (this.inFlight > 0) {
      this.events.emit("status", `Processing ${this.inFlight} chunk${this.inFlight > 1 ? "s" : ""}...`);
    } else if (this.isRecording) {
      this.events.emit("status", "Listening...");
    }
  }

  private async processQueue(): Promise<void> {
    if (this.inFlight >= this.maxConcurrency || this.chunkQueue.length === 0) return;
    const item = this.chunkQueue.shift();
    if (!item) return;
    const { chunk, audioSource, capturedAt } = item;
    this.inFlight++;

    const startTime = Date.now();
    const chunkDurationMs = (chunk.length / (16000 * 2)) * 1000;
    this.updateInFlightDisplay();

    const useTranslation = this._translationEnabled;
    const schema = useTranslation ? this.audioTranscriptionSchema : this.transcriptionOnlySchema;

    try {
      const wavBuffer = pcmToWavBuffer(chunk, 16000);
      let transcript = "";
      let translation = "";
      let detectedLang: LanguageCode = this.config.sourceLang;
      let isPartial = false;
      let isNewTopic = false;

      if (this.config.debug) {
        log("INFO", `Transcription request [${this.config.transcriptionProvider}]: src=${audioSource} chunk=${chunkDurationMs.toFixed(0)}ms (${(wavBuffer.byteLength / 1024).toFixed(0)}KB), queue=${this.chunkQueue.length}, inflight=${this.inFlight}`);
      }

      if (this.config.transcriptionProvider === "elevenlabs") {
        const sttResult = await transcribeWithElevenLabs(
          wavBuffer,
          this.config.transcriptionModelId
        );
        transcript = sttResult.transcript;
        detectedLang = sttResult.sourceLanguage
          ?? detectSourceLanguage(
            transcript,
            this.config.sourceLang,
            this.config.targetLang
          );
        isPartial = this.isTranscriptLikelyPartial(transcript);

        if (useTranslation && transcript) {
          const post = await this.postProcessTranscriptText(
            transcript,
            detectedLang,
            true
          );
          translation = post.translation;
          detectedLang = post.sourceLanguage;
          isPartial = post.isPartial;
          isNewTopic = post.isNewTopic;
        }
      } else {
        const prompt = buildAudioPromptForStructured(
          this.config.direction,
          this.config.sourceLang,
          this.config.targetLang,
          getContextWindow(this.contextState),
          this.contextState.allKeyPoints.slice(-8)
        );
        if (!this.transcriptionModel) {
          throw new Error("Transcription model is not initialized.");
        }

        const { object: result, usage: finalUsage } = await generateObject({
          model: this.transcriptionModel,
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

        const inTok = finalUsage?.inputTokens ?? 0;
        const outTok = finalUsage?.outputTokens ?? 0;
        const totalCost = addCostToAcc(this.costAccumulator, inTok, outTok, "audio", this.config.transcriptionProvider);
        this.events.emit("cost-updated", totalCost);

        if (this.config.debug) {
          log("INFO", `Transcription response [${this.config.transcriptionProvider}]: ${Date.now() - startTime}ms, tokens: ${inTok}→${outTok}, queue: ${this.chunkQueue.length}`);
          this.events.emit("status", `Response: ${Date.now() - startTime}ms | T: ${inTok}→${outTok}`);
        }

        transcript = (result as { transcript?: string }).transcript?.trim() ?? "";
        translation = useTranslation
          ? ((result as { translation?: string }).translation?.trim() ?? "")
          : "";
        detectedLang = (result as { sourceLanguage: string }).sourceLanguage as LanguageCode;
        isPartial = (result as { isPartial: boolean }).isPartial;
        isNewTopic = (result as { isNewTopic: boolean }).isNewTopic;
      }

      if (this.config.debug && this.config.transcriptionProvider === "elevenlabs") {
        log("INFO", `Transcription response [${this.config.transcriptionProvider}]: ${Date.now() - startTime}ms, queue: ${this.chunkQueue.length}`);
        this.events.emit("status", `Response: ${Date.now() - startTime}ms`);
      }

      if (!translation && !transcript) {
        log("WARN", "Transcription returned empty transcript and translation");
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
      block.createdAt = capturedAt;
      block.sessionId = this.sessionId;
      this.events.emit("block-added", block);

      block.partial = isPartial;
      block.newTopic = isNewTopic;
      this.events.emit("block-updated", block);

      if (sourceText && hasTranslatableContent(sourceText)) {
        recordContext(this.contextState, sourceText);
      } else if (translation && hasTranslatableContent(translation)) {
        recordContext(this.contextState, translation);
      }

      this.maybeEmitFastTodoSuggestion(block);
      this.scheduleAnalysis();
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
      log("ERROR", `Transcription chunk failed after ${elapsed}ms (audio=${chunkDurationMs.toFixed(0)}ms): ${fullError}`);
      this.events.emit("status", `⚠ ${errorMsg}`);
    } finally {
      this.inFlight--;
      this.updateInFlightDisplay();
      if (this.chunkQueue.length && this.inFlight < this.maxConcurrency) {
        void this.processQueue();
      }
    }
  }

  private isTranscriptLikelyPartial(transcript: string): boolean {
    const trimmed = transcript.trim();
    if (!trimmed) return false;
    return !/[.!?\u3002\uFF01\uFF1F…]["')\]]?$/.test(trimmed);
  }

  private async postProcessTranscriptText(
    transcript: string,
    detectedLangHint: LanguageCode,
    useTranslation: boolean
  ): Promise<{
    sourceLanguage: LanguageCode;
    translation: string;
    isPartial: boolean;
    isNewTopic: boolean;
  }> {
    const fallback = {
      sourceLanguage: detectedLangHint,
      translation: "",
      isPartial: this.isTranscriptLikelyPartial(transcript),
      isNewTopic: false,
    };
    if (!transcript.trim()) return fallback;

    const contextWindow = getContextWindow(this.contextState);
    const summaryPoints = this.contextState.allKeyPoints.slice(-8);
    const summaryBlock = summaryPoints.length
      ? `Conversation summary:\n${summaryPoints.map((p) => `- ${p}`).join("\n")}\n\n`
      : "";
    const contextBlock = contextWindow.length
      ? `Recent transcript context:\n${contextWindow.join("\n")}\n\n`
      : "";

    const translationRule = !useTranslation
      ? "Translation must be an empty string."
      : this.config.direction === "source-target"
        ? `Translation rule:
- Treat sourceLanguage as "${this.config.sourceLang}" unless the transcript clearly contradicts it.
- Translate into "${this.config.targetLang}" (${this.targetLangName}).
- Translation must never be in the same language as transcript.`
        : `Translation rule:
- If sourceLanguage is "${this.config.sourceLang}", translate to "${this.config.targetLang}" (${this.targetLangName}).
- If sourceLanguage is "${this.config.targetLang}", translate to "${this.config.sourceLang}" (${this.sourceLangName}).
- If sourceLanguage is "en" and neither configured language is English, translation may be empty.
- Translation must never be in the same language as transcript.`;

    const prompt = `${summaryBlock}${contextBlock}You are post-processing a speech transcript from a dedicated STT model.
Do not rewrite the transcript text.

Transcript:
"""${transcript}"""

Detected language hint: "${detectedLangHint}"
${translationRule}

Return:
1) sourceLanguage
2) translation
3) isPartial
4) isNewTopic`;

    try {
      const { object, usage } = await generateObject({
        // Use the low-latency model path for per-chunk post-processing.
        model: this.todoModel,
        schema: this.textPostProcessSchema,
        prompt,
        abortSignal: AbortSignal.timeout(8000),
        temperature: 0,
      });

      const totalCost = addCostToAcc(
        this.costAccumulator,
        usage?.inputTokens ?? 0,
        usage?.outputTokens ?? 0,
        "text",
        "openrouter"
      );
      this.events.emit("cost-updated", totalCost);

      return {
        sourceLanguage: (object as { sourceLanguage: LanguageCode }).sourceLanguage,
        translation: ((object as { translation?: string }).translation ?? "").trim(),
        isPartial: (object as { isPartial: boolean }).isPartial,
        isNewTopic: (object as { isNewTopic: boolean }).isNewTopic,
      };
    } catch (error) {
      if (this.config.debug) {
        log("WARN", `Transcript post-processing failed: ${toReadableError(error)}`);
      }
      return fallback;
    }
  }

  private startAnalysisTimer() {
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }
    if (this.analysisHeartbeatTimer) {
      clearInterval(this.analysisHeartbeatTimer);
      this.analysisHeartbeatTimer = null;
    }
    this.analysisHeartbeatTimer = setInterval(() => {
      if (!this.isRecording) return;
      this.flushPendingFastTodoIfStale();
      this.scheduleAnalysis(0);
    }, this.analysisHeartbeatMs);
    this.analysisRequested = false;
  }

  private scheduleAnalysis(delayMs = this.analysisDebounceMs) {
    if (!this.isRecording) return;
    if (this.analysisInFlight) {
      this.analysisRequested = true;
      return;
    }
    if (this.analysisTimer) return;

    this.analysisTimer = setTimeout(() => {
      this.analysisTimer = null;
      void this.generateAnalysis();
    }, Math.max(0, delayMs));
  }

  private stopAnalysisTimer() {
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }
    if (this.analysisHeartbeatTimer) {
      clearInterval(this.analysisHeartbeatTimer);
      this.analysisHeartbeatTimer = null;
    }
    this.flushPendingFastTodo(true);
    this.analysisRequested = false;
  }

  private async generateAnalysis(): Promise<void> {
    if (this.analysisInFlight) {
      this.analysisRequested = true;
      return;
    }

    const allBlocks = [...this.contextState.transcriptBlocks.values()];
    if (allBlocks.length <= this.lastAnalysisBlockCount) return;

    // Send all blocks since last analysis, plus up to 10 earlier blocks for context continuity
    const newBlocks = allBlocks.slice(this.lastAnalysisBlockCount);
    if (newBlocks.length < 1) return;
    const analysisTargetBlockCount = allBlocks.length;
    const contextStart = Math.max(0, this.lastAnalysisBlockCount - 10);
    const recentBlocks = allBlocks.slice(contextStart);

    this.analysisInFlight = true;
    this.analysisRequested = false;
    let analysisSucceeded = false;
    const startTime = Date.now();

    try {
      const existingTodos = this.db ? this.db.getTodos() : [];
      const previousKeyPoints = this.contextState.allKeyPoints.slice(-20);

      const analysisPrompt = buildAnalysisPrompt(recentBlocks, previousKeyPoints);

      const analysisProvider = this.config.analysisProvider;
      const providerOptions = analysisProvider === "google" || analysisProvider === "vertex"
        ? { google: { thinkingConfig: { includeThoughts: false, thinkingBudget: 2048 } } }
        : undefined;

      const { object: analysisResult, usage } = await generateObject({
        model: this.analysisModel,
        schema: analysisSchema,
        prompt: analysisPrompt,
        abortSignal: AbortSignal.timeout(30000),
        temperature: 0,
        providerOptions,
      });

      const elapsed = Date.now() - startTime;
      const totalCost = addCostToAcc(
        this.costAccumulator,
        usage?.inputTokens ?? 0,
        usage?.outputTokens ?? 0,
        "text",
        this.config.analysisProvider
      );
      this.events.emit("cost-updated", totalCost);
      this.lastAnalysisBlockCount = analysisTargetBlockCount;
      analysisSucceeded = true;

      // Update key points / summary — persist each as an insight so history survives
      this.contextState.allKeyPoints.push(...analysisResult.keyPoints);
      for (const text of analysisResult.keyPoints) {
        const kpInsight: Insight = {
          id: crypto.randomUUID(),
          kind: "key-point",
          text,
          sessionId: this.sessionId,
          createdAt: Date.now(),
        };
        this.db?.insertInsight(kpInsight);
      }
      this.lastSummary = { keyPoints: analysisResult.keyPoints, updatedAt: Date.now() };
      this.events.emit("summary-updated", this.lastSummary);

      // Emit educational insights
      for (const item of analysisResult.educationalInsights) {
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

      let todoSuggestions: string[] = [];
      try {
        const todoPrompt = buildTodoPrompt(recentBlocks, existingTodos);
        const { object: todoResult, usage: todoUsage } = await generateObject({
          model: this.todoModel,
          schema: todoAnalysisSchema,
          prompt: todoPrompt,
          abortSignal: AbortSignal.timeout(15000),
          temperature: 0,
        });

        const totalWithTodo = addCostToAcc(
          this.costAccumulator,
          todoUsage?.inputTokens ?? 0,
          todoUsage?.outputTokens ?? 0,
          "text",
          "openrouter"
        );
        this.events.emit("cost-updated", totalWithTodo);
        todoSuggestions = todoResult.suggestedTodos;
      } catch (todoError) {
        if (this.config.debug) {
          log("WARN", `Todo extraction failed: ${toReadableError(todoError)}`);
        }
      }

      if (this.config.debug) {
        log("INFO", `Analysis response: ${elapsed}ms, keyPoints=${analysisResult.keyPoints.length}, insights=${analysisResult.educationalInsights.length}, todos=${todoSuggestions.length}`);
      }

      // Emit todo suggestions (not auto-added — user must accept)
      const existingTodoTexts = existingTodos.map((t) => t.text);
      const emittedTodoSuggestions: string[] = [];
      for (const text of todoSuggestions) {
        const candidate = text.trim();
        if (!candidate) continue;
        if (!this.tryEmitTodoSuggestion(candidate, existingTodoTexts, emittedTodoSuggestions)) {
          continue;
        }
        emittedTodoSuggestions.push(candidate);
      }
    } catch (error) {
      if (this.config.debug) {
        log("WARN", `Analysis failed: ${toReadableError(error)}`);
      }
    } finally {
      this.analysisInFlight = false;
      const hasUnanalyzedBlocks = this.contextState.transcriptBlocks.size > this.lastAnalysisBlockCount;
      if (this.isRecording && (this.analysisRequested || hasUnanalyzedBlocks)) {
        this.analysisRequested = false;
        this.scheduleAnalysis(analysisSucceeded ? 0 : this.analysisRetryDelayMs);
      }
    }
  }

  private isDuplicateTodoSuggestion(
    candidate: string,
    existingTodoTexts: readonly string[],
    emittedInCurrentAnalysis: readonly string[]
  ): boolean {
    const normalizedCandidate = normalizeTodoText(candidate);
    if (!normalizedCandidate) return true;

    const exactMatch = (text: string) => normalizeTodoText(text) === normalizedCandidate;
    if (existingTodoTexts.some(exactMatch)) return true;
    if (emittedInCurrentAnalysis.some(exactMatch)) return true;
    if (this.recentSuggestedTodoTexts.some(exactMatch)) return true;

    const fuzzyMatch = (text: string) => isLikelyDuplicateTodoText(candidate, text);
    if (existingTodoTexts.some(fuzzyMatch)) return true;
    if (emittedInCurrentAnalysis.some(fuzzyMatch)) return true;
    if (this.recentSuggestedTodoTexts.some(fuzzyMatch)) return true;

    return false;
  }

  private tryEmitTodoSuggestion(
    candidate: string,
    existingTodoTexts?: readonly string[],
    emittedInCurrentAnalysis: readonly string[] = []
  ): boolean {
    const normalized = candidate.trim();
    if (!normalized) return false;

    const knownTodoTexts = existingTodoTexts ?? (this.db ? this.db.getTodos().map((t) => t.text) : []);
    if (this.isDuplicateTodoSuggestion(normalized, knownTodoTexts, emittedInCurrentAnalysis)) {
      return false;
    }

    const suggestion: TodoSuggestion = {
      id: crypto.randomUUID(),
      text: normalized,
      sessionId: this.sessionId,
      createdAt: Date.now(),
    };
    this.recentSuggestedTodoTexts.push(normalized);
    if (this.recentSuggestedTodoTexts.length > 500) {
      this.recentSuggestedTodoTexts = this.recentSuggestedTodoTexts.slice(-500);
    }
    this.events.emit("todo-suggested", suggestion);
    return true;
  }

  private clearPendingFastTodoTimer() {
    if (!this.pendingFastTodoTimer) return;
    clearTimeout(this.pendingFastTodoTimer);
    this.pendingFastTodoTimer = null;
  }

  private setPendingFastTodo(text: string, createdAt: number, flushAfterMs: number) {
    this.pendingFastTodo = {
      text: text.trim(),
      createdAt,
      flushAfterMs: Math.max(200, flushAfterMs),
    };
    this.armPendingFastTodoTimer();
  }

  private clearPendingFastTodo() {
    this.pendingFastTodo = null;
    this.clearPendingFastTodoTimer();
  }

  private armPendingFastTodoTimer() {
    this.clearPendingFastTodoTimer();
    if (!this.pendingFastTodo) return;
    const elapsed = Date.now() - this.pendingFastTodo.createdAt;
    const remainingMs = Math.max(50, this.pendingFastTodo.flushAfterMs - elapsed);
    this.pendingFastTodoTimer = setTimeout(() => {
      this.pendingFastTodoTimer = null;
      this.flushPendingFastTodoIfStale();
    }, remainingMs);
  }

  private maybeEmitReferenceFastTodo(
    candidates: readonly string[],
    createdAt: number
  ): boolean {
    const isReferenceCommand = candidates.some((text) => this.isReferenceTodoCommand(text));
    if (!isReferenceCommand) return false;

    if (this.pendingFastTodo) {
      const didEmit = this.tryEmitTodoSuggestion(this.pendingFastTodo.text);
      this.clearPendingFastTodo();
      return didEmit;
    }

    if (
      this.lastFastTodoCandidate &&
      createdAt - this.lastFastTodoCandidate.createdAt <= this.fastTodoReferenceWindowMs
    ) {
      return this.tryEmitTodoSuggestion(this.lastFastTodoCandidate.text);
    }

    return false;
  }

  private maybeEmitFastTodoSuggestion(block: {
    sourceText: string;
    translation?: string;
    partial?: boolean;
    createdAt: number;
  }) {
    this.flushPendingFastTodoIfStale(block.createdAt);

    const candidates = [block.sourceText, block.translation].filter((value): value is string => !!value && value.trim().length > 0);
    if (candidates.length === 0) return;

    if (this.maybeEmitReferenceFastTodo(candidates, block.createdAt)) {
      return;
    }

    if (
      this.pendingFastTodo &&
      block.createdAt - this.pendingFastTodo.createdAt <= this.fastTodoContinuationWindowMs
    ) {
      const preferredContinuation = candidates.find((value) => /[a-z]/i.test(value)) ?? candidates[0];
      const continuation = this.cleanFastTodoText(preferredContinuation);
      if (this.isLikelyTodoContinuation(continuation)) {
        const merged = this.mergeTodoParts(this.pendingFastTodo.text, continuation);
        if (this.shouldWaitForTodoContinuation(merged, !!block.partial)) {
          this.setPendingFastTodo(merged, block.createdAt, this.fastTodoContinuationWindowMs);
        } else {
          const didEmit = this.tryEmitTodoSuggestion(merged);
          if (!didEmit) {
            this.lastFastTodoCandidate = { text: merged, createdAt: block.createdAt };
          }
          this.clearPendingFastTodo();
        }
        return;
      }
    }

    for (const candidateText of candidates) {
      const extracted = this.extractFastTodoCandidate(candidateText, !!block.partial);
      if (!extracted) continue;
      this.lastFastTodoCandidate = { text: extracted.text, createdAt: block.createdAt };

      if (extracted.needsContinuation) {
        this.setPendingFastTodo(extracted.text, block.createdAt, this.fastTodoContinuationWindowMs);
      } else if (extracted.triggerType === "implicit") {
        this.setPendingFastTodo(extracted.text, block.createdAt, this.fastTodoImplicitHoldMs);
      } else {
        const didEmit = this.tryEmitTodoSuggestion(extracted.text);
        if (!didEmit) {
          this.lastFastTodoCandidate = { text: extracted.text, createdAt: block.createdAt };
        }
        this.clearPendingFastTodo();
      }
      return;
    }
  }

  private extractFastTodoCandidate(
    text: string,
    isPartial: boolean
  ): { text: string; needsContinuation: boolean; triggerType: FastTodoTriggerType } | null {
    const cleaned = this.cleanFastTodoText(text);
    if (!cleaned) return null;

    const explicitTrigger = /\b(add(?:\s+\w+){0,3}\s+(?:to-?do(?:s)?|to do(?:s)?)|to-?do(?:s)?|to do(?:s)?|todo(?:s)?|remind me to|don't forget to|do not forget to)\b/i;
    const implicitTrigger = /\b(i need to|we need to|i want to|i wanna|we should|let's|look into|find out|should check)\b/i;
    const explicitMatch = cleaned.match(explicitTrigger);
    const implicitMatch = cleaned.match(implicitTrigger);
    const explicitIdx = explicitMatch?.index ?? Number.POSITIVE_INFINITY;
    const implicitIdx = implicitMatch?.index ?? Number.POSITIVE_INFINITY;
    const triggerType: FastTodoTriggerType =
      explicitIdx <= implicitIdx ? "explicit" : "implicit";
    const startIndex = Math.min(explicitIdx, implicitIdx);
    if (!Number.isFinite(startIndex)) return null;

    let candidate = cleaned.slice(startIndex);
    candidate = candidate.replace(
      /^(?:add(?:\s+\w+){0,3}\s+(?:to-?do(?:s)?|to do(?:s)?)|to-?do(?:s)?|to do(?:s)?|todo(?:s)?|remind me to|don't forget to|do not forget to)[:\s,-]*/i,
      ""
    );
    candidate = candidate.replace(/^(?:so|um|uh|okay|ok|well|like|please|just)\b[\s,.-]*/i, "");
    candidate = candidate.replace(/\s+/g, " ").trim();

    if (!candidate || candidate.length < 8) return null;
    return {
      text: candidate,
      needsContinuation: this.shouldWaitForTodoContinuation(candidate, isPartial),
      triggerType,
    };
  }

  private isReferenceTodoCommand(text: string): boolean {
    const cleaned = this.cleanFastTodoText(text).toLowerCase();
    if (!cleaned) return false;
    const hasAdd = /\badd\b/.test(cleaned);
    if (!hasAdd) return false;

    if (/\badd\b[\s\w]*\b(that|this|it)\b/.test(cleaned)) {
      return true;
    }

    const commandOnlyMatch = cleaned.match(/\badd(?:\s+\w+){0,3}\s+(?:to-?do(?:s)?|to do(?:s)?|todo(?:s)?)\b/i);
    if (!commandOnlyMatch || commandOnlyMatch.index == null) return false;
    const trailing = cleaned
      .slice(commandOnlyMatch.index + commandOnlyMatch[0].length)
      .replace(/^[\s,.:;!?-]+/, "")
      .trim();
    return trailing.length === 0;
  }

  private cleanFastTodoText(text: string): string {
    return text
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private isLikelyTodoContinuation(text: string): boolean {
    const cleaned = text.trim();
    if (!cleaned) return false;
    if (!/[a-z0-9]/i.test(cleaned)) return false;
    if (/^(?:ok|okay|yes|no|sure|hmm|uh|um)\b/i.test(cleaned)) return false;
    return cleaned.split(/\s+/).length >= 2;
  }

  private mergeTodoParts(base: string, continuation: string): string {
    const left = base.trim().replace(/[,\s-]+$/, "");
    const right = continuation.trim().replace(/^[,\s-]+/, "");
    if (!left) return right;
    if (!right) return left;
    return `${left} ${right}`.replace(/\s+/g, " ").trim();
  }

  private shouldWaitForTodoContinuation(text: string, isPartial: boolean): boolean {
    if (isPartial) return true;
    const t = text.trim().toLowerCase();
    return /(?:-|:|,|;|\/)$/.test(t) || /\b(and|to|for|with|about|at|look at|look into)$/.test(t);
  }

  private flushPendingFastTodo(force = false) {
    if (!this.pendingFastTodo) return;
    if (!force) {
      this.clearPendingFastTodoTimer();
      return;
    }
    this.tryEmitTodoSuggestion(this.pendingFastTodo.text);
    this.clearPendingFastTodo();
  }

  private flushPendingFastTodoIfStale(now = Date.now()) {
    if (!this.pendingFastTodo) return;
    if (now - this.pendingFastTodo.createdAt < this.pendingFastTodo.flushAfterMs) {
      this.armPendingFastTodoTimer();
      return;
    }
    this.tryEmitTodoSuggestion(this.pendingFastTodo.text);
    this.clearPendingFastTodo();
  }
}
