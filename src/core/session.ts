import { EventEmitter } from "node:events";
import { type ChildProcess } from "node:child_process";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

import type {
  Agent,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
  AudioSource,
  TranscriptBlock,
  SessionConfig,
  SessionEvents,
  Summary,
  UIState,
  LanguageCode,
  TodoSuggestion,
  Insight,
} from "./types";
import { createTranscriptionModel, createAnalysisModel, createTodoModel } from "./providers";
import { log } from "./logger";
import { pcmToWavBuffer, computeRms } from "./audio/audio-utils";
import { isLikelyDuplicateTodoText, normalizeTodoText, toReadableError } from "./text/text-utils";
import {
  analysisSchema,
  todoAnalysisSchema,
  type TodoExtractSuggestion,
  todoFromSelectionSchema,
  buildAnalysisPrompt,
  buildTodoPrompt,
  buildTodoFromSelectionPrompt,
} from "./analysis/analysis";
import { classifyTodoSize as classifyTodoSizeWithModel, type TodoSizeClassification } from "./analysis/todo-size";
import type { AppDatabase } from "./db/db";
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
} from "./audio/vad";
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
} from "./audio/audio";
import { createAgentManager, type AgentManager } from "./agents/agent-manager";
import type { AgentExternalToolSet } from "./agents/external-tools";
import {
  connectElevenLabsRealtime,
  normalizeElevenLabsLanguageCode,
  RealtimeEvents,
  type RealtimeConnection,
} from "./transcription/elevenlabs";
import { preloadWhisperPipeline, disposeWhisperPipeline, transcribeWithWhisper } from "./transcription/whisper-local";
import {
  getParagraphDecisionPromptTemplate,
  getTranscriptPostProcessPromptTemplate,
  renderPromptTemplate,
} from "./prompt-loader";

type TypedEmitter = EventEmitter & {
  emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean;
  on<K extends keyof SessionEvents>(event: K, listener: (...args: SessionEvents[K]) => void): TypedEmitter;
};

type AudioPipeline = {
  source: AudioSource;
  vadState: VadState;
  overlap: Buffer;
};

type WhisperPendingParagraph = {
  transcript: string;
  detectedLangHint: LanguageCode;
  audioSource: AudioSource;
  capturedAt: number;
  lastUpdatedAt: number;
};

type TodoSuggestionDraft = {
  text: string;
  details?: string;
  transcriptExcerpt?: string;
};

export type SessionExternalDeps = {
  getExternalTools?: () => Promise<AgentExternalToolSet>;
};

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
  private whisperParagraphDecisionSchema: z.ZodObject<z.ZodRawShape>;

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

  // ElevenLabs realtime — one connection per active audio source
  private systemConnection: RealtimeConnection | null = null;
  private micConnection: RealtimeConnection | null = null;
  private systemReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private micReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private whisperPendingParagraphs = new Map<AudioSource, WhisperPendingParagraph>();
  private whisperParagraphDecisionInFlight = false;
  private whisperLastParagraphDecisionAt = 0;
  private readonly whisperParagraphDecisionIntervalMs = 10_000;

  private contextState: ContextState = createContextState();
  private costAccumulator: CostAccumulator = createCostAccumulator();
  private userContext: string;
  private _translationEnabled: boolean;

  private analysisTimer: NodeJS.Timeout | null = null;
  private analysisHeartbeatTimer: NodeJS.Timeout | null = null;
  private analysisInFlight = false;
  private analysisIdleWaiters: Array<() => void> = [];
  private analysisRequested = false;
  private readonly analysisDebounceMs = 300;
  private readonly analysisHeartbeatMs = 5000;
  private readonly analysisRetryDelayMs = 2000;
  private readonly todoAnalysisIntervalMs = 10_000;
  private readonly todoAnalysisMaxBlocks = 60;
  private recentSuggestedTodoTexts: string[] = [];
  private todoScanRequested = false;
  private lastTodoAnalysisAt = 0;
  private lastTodoAnalysisBlockCount = 0;
  private lastSummary: Summary | null = null;
  private lastAnalysisBlockCount = 0;
  private db: AppDatabase | null;
  private agentManager: AgentManager | null = null;
  private getExternalTools?: () => Promise<AgentExternalToolSet>;

  private sourceLangLabel: string;
  private targetLangLabel: string;
  private sourceLangName: string;
  private targetLangName: string;

  constructor(config: SessionConfig, db?: AppDatabase, sessionId?: string, externalDeps?: SessionExternalDeps) {
    this.config = config;
    this.db = db ?? null;
    this.sessionId = sessionId ?? crypto.randomUUID();
    this.getExternalTools = externalDeps?.getExternalTools;
    this._translationEnabled = config.translationEnabled;
    this.userContext = loadUserContext(config.contextFile, config.useContext);

    this.transcriptionModel =
      config.transcriptionProvider === "elevenlabs" ||
      config.transcriptionProvider === "whisper"
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
        getProjectInstructions: () => {
          const meta = this.db?.getSession(this.sessionId);
          if (!meta?.projectId) return undefined;
          return this.db?.getProject(meta.projectId)?.instructions ?? undefined;
        },
        getExternalTools: this.getExternalTools,
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

    this.whisperParagraphDecisionSchema = z.object({
      shouldCommit: z
        .boolean()
        .describe("True if the running transcript has reached a natural paragraph break and should be committed now."),
      isPartial: z
        .boolean()
        .describe("True when the running transcript still sounds incomplete."),
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
      canTranslate: this.canTranslate,
      micEnabled: this._micEnabled,
    };
  }

  get recording(): boolean {
    return this.isRecording;
  }

  get allKeyPoints(): readonly string[] {
    return this.contextState.allKeyPoints;
  }

  get canTranslate(): boolean {
    return this.config.transcriptionProvider === "vertex";
  }

  get translationEnabled(): boolean {
    return this._translationEnabled;
  }

  get micEnabled(): boolean {
    return this._micEnabled;
  }

  async initialize(): Promise<void> {
    // Seed context with existing key points for this session only.
    // This keeps analysis anchored to the active conversation.
    if (this.db) {
      const existingSessionKeyPoints = this.db
        .getInsightsForSession(this.sessionId)
        .filter((insight) => insight.kind === "key-point")
        .map((insight) => insight.text);

      if (existingSessionKeyPoints.length > 0) {
        this.contextState.allKeyPoints.push(...existingSessionKeyPoints);
        log("INFO", `Loaded ${existingSessionKeyPoints.length} key points for session ${this.sessionId}`);
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
    this.whisperPendingParagraphs.clear();
    this.whisperLastParagraphDecisionAt = 0;
    this.events.emit("partial", "");

    if (!resume) {
      resetContextState(this.contextState);
      resetCost(this.costAccumulator);
      this.lastSummary = null;
      this.lastAnalysisBlockCount = 0;
      this.lastTodoAnalysisBlockCount = 0;
      this.lastTodoAnalysisAt = 0;
      this.recentSuggestedTodoTexts = [];
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

    if (this.config.transcriptionProvider === "elevenlabs") {
      void this.openElevenLabsConnection("system");
    }

    if (this.config.transcriptionProvider === "whisper") {
      this.events.emit("status", "Loading Whisper model...");
      preloadWhisperPipeline(this.config.transcriptionModelId)
        .then(() => { this.events.emit("status", "Whisper ready. Speak now."); })
        .catch((err: Error) => { this.events.emit("error", `Whisper load failed: ${err.message}`); });
    }
  }

  stopRecording(flushRemaining = true, commitWhisperPending = true, clearQueue = true): void {
    if (!this.isRecording) return;
    this.isRecording = false;

    this.stopAnalysisTimer();

    // Close ElevenLabs WS before killing audio capture
    if (this.config.transcriptionProvider === "elevenlabs") {
      this.closeElevenLabsConnection("system");
    }

    if (this.audioRecorder) { this.audioRecorder.stop(); this.audioRecorder = null; }
    if (this.ffmpegProcess) { this.ffmpegProcess.kill("SIGTERM"); this.ffmpegProcess = null; }

    // VAD flush only needed for Google/Vertex/Whisper
    if (flushRemaining && this.config.transcriptionProvider !== "elevenlabs") {
      const remaining = flushVad(this.systemPipeline.vadState);
      if (remaining) {
        this.enqueueChunk(this.systemPipeline, remaining);
        void this.processQueue();
      }
    }
    if (commitWhisperPending && this.config.transcriptionProvider === "whisper") {
      void this.evaluateWhisperParagraphs(true);
    }

    if (this._micEnabled) this.stopMic(commitWhisperPending);

    if (clearQueue) {
      this.chunkQueue = [];
      this.inFlight = 0;
    } else if (this.chunkQueue.length && this.inFlight < this.maxConcurrency) {
      void this.processQueue();
    }
    this.systemPipeline.overlap = Buffer.alloc(0);
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

      if (this.config.transcriptionProvider === "elevenlabs") {
        void this.openElevenLabsConnection("microphone");
      }

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
      this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
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

    if (this.config.transcriptionProvider === "elevenlabs") {
      void this.openElevenLabsConnection("microphone");
    }

    log("INFO", "Mic started via renderer capture (Web Audio API)");
    this.events.emit("status", "Mic active — listening...");
    this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
  }

  /** Receive PCM audio from renderer IPC */
  feedMicAudio(data: Buffer): void {
    if (!this._micEnabled) return;
    this.handleAudioData(this.micPipeline, data);
  }

  stopMic(commitWhisperPending = true): void {
    if (!this._micEnabled) return;

    if (this.config.transcriptionProvider === "elevenlabs") {
      this.closeElevenLabsConnection("microphone");
    } else {
      const remaining = flushVad(this.micPipeline.vadState);
      if (remaining) {
        this.enqueueChunk(this.micPipeline, remaining);
        void this.processQueue();
      }
      if (commitWhisperPending && this.config.transcriptionProvider === "whisper") {
        void this.evaluateWhisperParagraphs(true, ["microphone"]);
      }
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
    if (!this.canTranslate) return false;
    this._translationEnabled = !this._translationEnabled;
    this.events.emit("state-change", this.getUIState(this.isRecording ? "recording" : "paused"));
    log("INFO", `Translation ${this._translationEnabled ? "enabled" : "disabled"}`);
    return this._translationEnabled;
  }

  async requestTodoScan(): Promise<{
    ok: boolean;
    queued: boolean;
    todoAnalysisRan: boolean;
    todoSuggestionsEmitted: number;
    suggestions: TodoSuggestion[];
    error?: string;
  }> {
    if (this.contextState.transcriptBlocks.size === 0) {
      this.hydrateTranscriptContextFromDb();
    }
    if (this.contextState.transcriptBlocks.size === 0) {
      this.events.emit("status", "Todo scan: no transcript available yet.");
      return {
        ok: false,
        queued: false,
        todoAnalysisRan: false,
        todoSuggestionsEmitted: 0,
        suggestions: [],
        error: "No transcript available to scan yet",
      };
    }

    this.todoScanRequested = true;
    this.events.emit("status", "Todo scan running...");
    if (this.analysisInFlight) {
      this.events.emit("status", "Todo scan waiting for current analysis...");
      await this.waitForAnalysisIdle();
    }

    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }
    this.analysisRequested = false;

    let analysisResult = await this.generateAnalysis();
    if (!analysisResult.todoAnalysisRan && this.todoScanRequested) {
      // Rare race: another analysis started between idle/wakeup and our forced scan.
      await this.waitForAnalysisIdle();
      analysisResult = await this.generateAnalysis();
    }

    return {
      ok: true,
      queued: false,
      todoAnalysisRan: analysisResult.todoAnalysisRan,
      todoSuggestionsEmitted: analysisResult.todoSuggestionsEmitted,
      suggestions: analysisResult.suggestions,
    };
  }

  private hydrateTranscriptContextFromDb() {
    if (!this.db) return;
    if (this.contextState.transcriptBlocks.size > 0) return;

    const persistedBlocks = this.db
      .getBlocksForSession(this.sessionId)
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id - b.id;
      });

    if (persistedBlocks.length === 0) return;

    this.contextState.contextBuffer.length = 0;
    this.contextState.transcriptBlocks.clear();

    let maxBlockId = 0;
    for (const block of persistedBlocks) {
      this.contextState.transcriptBlocks.set(block.id, block);
      if (block.id > maxBlockId) maxBlockId = block.id;

      if (block.sourceText && hasTranslatableContent(block.sourceText)) {
        recordContext(this.contextState, block.sourceText);
      } else if (block.translation && hasTranslatableContent(block.translation)) {
        recordContext(this.contextState, block.translation);
      }
    }

    this.contextState.nextBlockId = Math.max(this.contextState.nextBlockId, maxBlockId + 1);
    // Prevent backfilling summary/insights when the user only requests a todo scan.
    this.lastAnalysisBlockCount = this.contextState.transcriptBlocks.size;
  }

  async shutdown(): Promise<void> {
    log("INFO", "Session shutdown");
    if (this.config.transcriptionProvider === "whisper") {
      log(
        "INFO",
        `Whisper shutdown flush start: queue=${this.chunkQueue.length} inflight=${this.inFlight} pendingParagraphs=${this.whisperPendingParagraphs.size}`,
      );
    }
    if (this._micEnabled) this.stopMic(false);
    if (this.isRecording) this.stopRecording(true, false, false);
    if (this.config.transcriptionProvider !== "elevenlabs") {
      await this.waitForTranscriptionDrain();
    }
    if (this.config.transcriptionProvider === "whisper") {
      await this.waitForWhisperParagraphDecisionIdle();
      await this.evaluateWhisperParagraphs(true);
      log("INFO", `Whisper shutdown flush done: pendingParagraphs=${this.whisperPendingParagraphs.size}`);
      this.whisperPendingParagraphs.clear();
      disposeWhisperPipeline();
    } else {
      this.whisperPendingParagraphs.clear();
    }
    this.events.emit("partial", "");
    writeSummaryLog(this.contextState.allKeyPoints);
  }

  launchAgent(todoId: string, task: string, taskContext?: string): Agent | null {
    if (!this.agentManager) return null;
    return this.agentManager.launchAgent(todoId, task, this.sessionId, taskContext);
  }

  async classifyTodoSize(text: string): Promise<TodoSizeClassification> {
    const result = await classifyTodoSizeWithModel(this.todoModel, text);
    log(
      "INFO",
      `Todo size classified: size=${result.size} confidence=${result.confidence.toFixed(2)} reason=${result.reason}`
    );
    return result;
  }

  async extractTodoFromSelection(
    selectedText: string,
    userIntentText?: string,
  ): Promise<{ ok: boolean; todoTitle?: string; todoDetails?: string; reason?: string; error?: string }> {
    const trimmedSelection = selectedText.trim();
    if (!trimmedSelection) {
      return { ok: false, error: "Selected text is required" };
    }

    const existingTodos = this.db
      ? this.db.getTodosForSession(this.sessionId)
      : [];
    const prompt = buildTodoFromSelectionPrompt(trimmedSelection, existingTodos, userIntentText);

    try {
      const { object, usage } = await generateObject({
        model: this.todoModel,
        schema: todoFromSelectionSchema,
        prompt,
        abortSignal: AbortSignal.timeout(10000),
        temperature: 0,
      });

      const totalWithTodo = addCostToAcc(
        this.costAccumulator,
        usage?.inputTokens ?? 0,
        usage?.outputTokens ?? 0,
        "text",
        "openrouter"
      );
      this.events.emit("cost-updated", totalWithTodo);

      const todoTitle = object.todoTitle.trim();
      const todoDetails = object.todoDetails.trim();
      if (!object.shouldCreateTodo || !todoTitle) {
        return {
          ok: true,
          reason: object.reason || "No actionable todo found in selection.",
        };
      }

      const existingTexts = existingTodos.map((todo) => todo.text);
      const isDuplicate = this.isDuplicateTodoSuggestion(todoTitle, existingTexts, []);
      if (isDuplicate) {
        return {
          ok: true,
          reason: "This todo already exists.",
        };
      }

      return {
        ok: true,
        todoTitle,
        todoDetails,
        reason: object.reason,
      };
    } catch (error) {
      if (this.config.debug) {
        log("WARN", `Todo extraction from selection failed: ${toReadableError(error)}`);
      }
      return { ok: false, error: toReadableError(error) };
    }
  }

  getAgents(): Agent[] {
    return this.agentManager?.getAllAgents() ?? [];
  }

  followUpAgent(agentId: string, question: string): boolean {
    return this.agentManager?.followUpAgent(agentId, question) ?? false;
  }

  answerAgentQuestion(agentId: string, answers: AgentQuestionSelection[]): { ok: boolean; error?: string } {
    return this.agentManager?.answerAgentQuestion(agentId, answers) ?? { ok: false, error: "Agent system unavailable" };
  }

  answerAgentToolApproval(agentId: string, response: AgentToolApprovalResponse): { ok: boolean; error?: string } {
    return this.agentManager?.answerAgentToolApproval(agentId, response) ?? { ok: false, error: "Agent system unavailable" };
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
    if (this.config.transcriptionProvider === "elevenlabs") {
      // Realtime path: stream raw PCM directly, no local VAD or queue
      const connection = pipeline.source === "system"
        ? this.systemConnection
        : this.micConnection;
      if (connection) {
        try {
          connection.send({ audioBase64: data.toString("base64") });
        } catch (err) {
          log("WARN", `ElevenLabs send failed (${pipeline.source}): ${toReadableError(err)}`);
        }
      }
      return;
    }

    const vadOptions =
      this.config.transcriptionProvider === "whisper"
        ? { maxChunkMs: null } // Whisper: prefer natural-break chunks only.
        : undefined;
    const chunks = processAudioData(pipeline.vadState, data, vadOptions);

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

  private async openElevenLabsConnection(source: AudioSource): Promise<void> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      this.events.emit("error", "Missing ELEVENLABS_API_KEY");
      return;
    }
    const languageCode = this.config.direction === "source-target"
      ? this.config.sourceLang
      : undefined;

    let connection: RealtimeConnection;
    try {
      connection = await connectElevenLabsRealtime({
        apiKey,
        modelId: this.config.transcriptionModelId,
        languageCode,
      });
    } catch (err) {
      log("ERROR", `ElevenLabs WS connect failed (${source}): ${toReadableError(err)}`);
      this.events.emit("status", `⚠ ElevenLabs connection failed`);
      this.scheduleElevenLabsReconnect(source, 2000);
      return;
    }

    // Guard: stop() may have been called while we were awaiting connect()
    if (!this.isRecording || (source === "microphone" && !this._micEnabled)) {
      connection.close();
      return;
    }

    if (source === "system") this.systemConnection = connection;
    else this.micConnection = connection;

    this.attachElevenLabsHandlers(connection, source);
    log("INFO", `ElevenLabs WS connected (${source})`);
  }

  private attachElevenLabsHandlers(connection: RealtimeConnection, source: AudioSource): void {
    connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (msg) => {
      if (msg.text) this.events.emit("partial", `${msg.text}`);
    });

    connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, (msg) => {
      const text = msg.text?.trim();
      if (!text) return;
      const langHint = normalizeElevenLabsLanguageCode(msg.language_code)
        ?? detectSourceLanguage(text, this.config.sourceLang, this.config.targetLang);
      void this.handleElevenLabsCommit(text, langHint, source, Date.now());
    });

    connection.on(RealtimeEvents.SESSION_TIME_LIMIT_EXCEEDED, () => {
      log("WARN", `ElevenLabs session limit hit (${source}), reconnecting`);
      connection.close();
      if (source === "system") this.systemConnection = null;
      else this.micConnection = null;
      if (this.isRecording) this.scheduleElevenLabsReconnect(source, 500);
    });

    connection.on(RealtimeEvents.CLOSE, () => {
      const current = source === "system" ? this.systemConnection : this.micConnection;
      if (current !== connection) return; // already replaced (e.g. by reconnect)
      if (source === "system") this.systemConnection = null;
      else this.micConnection = null;
      if (this.isRecording) {
        log("WARN", `ElevenLabs WS closed unexpectedly (${source}), reconnecting`);
        this.scheduleElevenLabsReconnect(source, 1000);
      }
    });

    connection.on(RealtimeEvents.ERROR, (err) => {
      const msg = "error" in err ? (err as { error: string }).error : (err as Error).message;
      log("ERROR", `ElevenLabs WS error (${source}): ${msg}`);
      this.events.emit("status", `⚠ STT error: ${msg}`);
    });
  }

  private async handleElevenLabsCommit(
    transcript: string,
    detectedLangHint: LanguageCode,
    audioSource: AudioSource,
    capturedAt: number
  ): Promise<void> {
    this.events.emit("partial", "");
    const useTranslation = this._translationEnabled && this.canTranslate;
    let detectedLang = detectedLangHint;
    let translation = "";
    let isPartial = this.isTranscriptLikelyPartial(transcript);
    let isNewTopic = false;

    if (useTranslation && transcript) {
      const post = await this.postProcessTranscriptText(transcript, detectedLangHint, true);
      translation = post.translation;
      detectedLang = post.sourceLanguage;
      isPartial = post.isPartial;
      isNewTopic = post.isNewTopic;
    }

    const isTargetLang = detectedLang === this.config.targetLang;
    const detectedLabel = getLanguageLabel(detectedLang);
    const translatedToLabel = isTargetLang
      ? getLanguageLabel(this.config.sourceLang)
      : getLanguageLabel(this.config.targetLang);

    const block = createBlock(
      this.contextState,
      detectedLabel,
      transcript,
      translatedToLabel,
      translation || undefined,
      audioSource,
    );
    block.createdAt = capturedAt;
    block.sessionId = this.sessionId;
    this.events.emit("block-added", block);

    block.partial = isPartial;
    block.newTopic = isNewTopic;
    this.events.emit("block-updated", block);

    if (hasTranslatableContent(transcript)) {
      recordContext(this.contextState, transcript);
    } else if (translation && hasTranslatableContent(translation)) {
      recordContext(this.contextState, translation);
    }

    // Paragraph was committed (not preview text), so run analysis immediately.
    this.scheduleAnalysis(0);
  }

  private mergeWhisperTranscript(existing: string, incoming: string): string {
    const a = existing.trim();
    const b = incoming.trim();
    if (!a) return b;
    if (!b) return a;
    if (a.endsWith(b)) return a;
    if (b.startsWith(a)) return b;
    // Conservative merge to avoid losing words in preview mode.
    // Prefer duplicates over dropping potentially new content.
    return `${a} ${b}`.replace(/\s+/g, " ").trim();
  }

  private updateWhisperPreview(): void {
    const latest = [...this.whisperPendingParagraphs.values()]
      .sort((left, right) => left.lastUpdatedAt - right.lastUpdatedAt)
      .at(-1);
    this.events.emit("partial", latest?.transcript ?? "");
  }

  private async evaluateWhisperParagraphs(forceCommit: boolean, sources?: AudioSource[]): Promise<void> {
    if (this.config.transcriptionProvider !== "whisper") return;
    if (this.whisperParagraphDecisionInFlight) return;
    const sourceSet = sources ? new Set(sources) : null;
    const candidates = [...this.whisperPendingParagraphs.values()].filter((entry) =>
      sourceSet ? sourceSet.has(entry.audioSource) : true
    );
    if (candidates.length === 0) return;

    this.whisperParagraphDecisionInFlight = true;
    try {
      for (const state of candidates) {
        const pending = this.whisperPendingParagraphs.get(state.audioSource);
        if (!pending) continue;
        if (!forceCommit && pending.transcript.trim().length < 24) continue;

        let transcriptForDecision = pending.transcript.trim();
        let shouldCommit = forceCommit;
        if (!forceCommit) {
          const prompt = renderPromptTemplate(getParagraphDecisionPromptTemplate(), {
            transcript: pending.transcript,
          });

          try {
            const { object } = await generateObject({
              model: this.todoModel,
              schema: this.whisperParagraphDecisionSchema,
              prompt,
              temperature: 0,
              abortSignal: AbortSignal.timeout(6000),
            });
            shouldCommit = !!(object as { shouldCommit: boolean }).shouldCommit;
            if ((object as { isPartial: boolean }).isPartial) {
              shouldCommit = false;
            }
          } catch (error) {
            if (this.config.debug) {
              log("WARN", `Whisper paragraph decision failed: ${toReadableError(error)}`);
            }
            // Fallback heuristic when model decision is unavailable.
            shouldCommit = /[.!?\u3002\uFF01\uFF1F…]["')\]]?$/.test(transcriptForDecision);
          }
        }

        if (!transcriptForDecision) {
          this.whisperPendingParagraphs.delete(pending.audioSource);
          this.updateWhisperPreview();
          continue;
        }

        if (!shouldCommit) {
          pending.transcript = transcriptForDecision;
          pending.lastUpdatedAt = Date.now();
          this.whisperPendingParagraphs.set(pending.audioSource, pending);
          this.updateWhisperPreview();
          continue;
        }

        this.whisperPendingParagraphs.delete(pending.audioSource);
        this.updateWhisperPreview();
        await this.handleElevenLabsCommit(
          transcriptForDecision,
          pending.detectedLangHint,
          pending.audioSource,
          pending.capturedAt,
        );
        this.updateWhisperPreview();
      }
    } finally {
      this.whisperParagraphDecisionInFlight = false;
    }
  }

  private queueWhisperParagraphChunk(
    transcript: string,
    detectedLangHint: LanguageCode,
    audioSource: AudioSource,
    capturedAt: number,
  ): void {
    const incoming = transcript.trim();
    if (!incoming) return;

    const existing = this.whisperPendingParagraphs.get(audioSource);
    if (!existing) {
      this.whisperPendingParagraphs.set(audioSource, {
        transcript: incoming,
        detectedLangHint,
        audioSource,
        capturedAt,
        lastUpdatedAt: Date.now(),
      });
    } else {
      existing.transcript = this.mergeWhisperTranscript(existing.transcript, incoming);
      existing.detectedLangHint = detectedLangHint;
      existing.lastUpdatedAt = Date.now();
      this.whisperPendingParagraphs.set(audioSource, existing);
    }

    this.updateWhisperPreview();

    const now = Date.now();
    if (now - this.whisperLastParagraphDecisionAt >= this.whisperParagraphDecisionIntervalMs) {
      this.whisperLastParagraphDecisionAt = now;
      void this.evaluateWhisperParagraphs(false, [audioSource]);
    }
  }

  private closeElevenLabsConnection(source: AudioSource): void {
    const timerField = source === "system" ? "systemReconnectTimer" : "micReconnectTimer";
    const connField = source === "system" ? "systemConnection" : "micConnection";
    if (this[timerField]) {
      clearTimeout(this[timerField]!);
      this[timerField] = null;
    }
    if (this[connField]) {
      this[connField]!.close();
      this[connField] = null;
    }
  }

  private scheduleElevenLabsReconnect(source: AudioSource, delayMs: number): void {
    const timerField = source === "system" ? "systemReconnectTimer" : "micReconnectTimer";
    if (this[timerField]) return; // already scheduled
    this[timerField] = setTimeout(() => {
      this[timerField] = null;
      if (!this.isRecording) return;
      if (source === "microphone" && !this._micEnabled) return;
      void this.openElevenLabsConnection(source);
    }, delayMs);
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

  private async waitForTranscriptionDrain(timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight > 0 || this.chunkQueue.length > 0) {
      if (this.inFlight < this.maxConcurrency && this.chunkQueue.length > 0) {
        void this.processQueue();
      }
      if (Date.now() >= deadline) {
        log(
          "WARN",
          `Timed out waiting for transcription drain: queue=${this.chunkQueue.length} inflight=${this.inFlight}`,
        );
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }

  private async waitForWhisperParagraphDecisionIdle(timeoutMs = 3000): Promise<void> {
    if (!this.whisperParagraphDecisionInFlight) return;
    const deadline = Date.now() + timeoutMs;
    while (this.whisperParagraphDecisionInFlight) {
      if (Date.now() >= deadline) {
        log("WARN", "Timed out waiting for Whisper paragraph decision to finish");
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }

  private async processQueue(): Promise<void> {
    // ElevenLabs uses persistent WS; this queue is for Google/Vertex/Whisper.
    if (this.config.transcriptionProvider === "elevenlabs") return;
    if (this.inFlight >= this.maxConcurrency || this.chunkQueue.length === 0) return;
    const item = this.chunkQueue.shift();
    if (!item) return;
    const { chunk, audioSource, capturedAt } = item;
    this.inFlight++;

    const startTime = Date.now();
    const chunkDurationMs = (chunk.length / (16000 * 2)) * 1000;
    let stopRecordingOnFatalWhisperError = false;
    this.updateInFlightDisplay();

    try {
      let transcript = "";
      let translation = "";
      let detectedLang: LanguageCode = this.config.sourceLang;
      let isPartial = false;
      let isNewTopic = false;

      if (this.config.debug) {
        log("INFO", `Transcription request [${this.config.transcriptionProvider}]: src=${audioSource} chunk=${chunkDurationMs.toFixed(0)}ms, queue=${this.chunkQueue.length}, inflight=${this.inFlight}`);
      }

      if (this.config.transcriptionProvider === "whisper") {
        const result = await transcribeWithWhisper(chunk, this.config.transcriptionModelId, this.config.sourceLang, this.config.targetLang);
        this.queueWhisperParagraphChunk(
          result.transcript,
          result.detectedLang,
          audioSource,
          capturedAt,
        );
        return;
      } else {
        const useTranslation = this._translationEnabled && this.canTranslate;
        const schema = useTranslation ? this.audioTranscriptionSchema : this.transcriptionOnlySchema;
        const wavBuffer = pcmToWavBuffer(chunk, 16000);

        if (this.config.debug) {
          log("INFO", `Audio buffer: ${(wavBuffer.byteLength / 1024).toFixed(0)}KB`);
        }

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
      const whisperDisposedDuringStop =
        this.config.transcriptionProvider === "whisper" &&
        !this.isRecording &&
        /Whisper process disposed/i.test(fullError);
      if (whisperDisposedDuringStop) {
        log("INFO", `Ignoring Whisper dispose error while stopping: ${fullError}`);
        return;
      }
      log("ERROR", `Transcription chunk failed after ${elapsed}ms (audio=${chunkDurationMs.toFixed(0)}ms): ${fullError}`);
      this.events.emit("status", `⚠ ${errorMsg}`);
      if (
        this.config.transcriptionProvider === "whisper" &&
        /Whisper process exited unexpectedly|Whisper worker exited unexpectedly|SIGTRAP|SIGABRT/i.test(fullError)
      ) {
        this.events.emit("error", `Whisper transcription failed: ${errorMsg}`);
        this.chunkQueue = [];
        stopRecordingOnFatalWhisperError = true;
      }
    } finally {
      this.inFlight--;
      this.updateInFlightDisplay();
      if (stopRecordingOnFatalWhisperError && this.isRecording) {
        this.stopRecording();
        return;
      }
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

    const prompt = renderPromptTemplate(getTranscriptPostProcessPromptTemplate(), {
      summary_block: summaryBlock,
      context_block: contextBlock,
      transcript,
      detected_lang_hint: detectedLangHint,
      translation_rule: translationRule,
    });

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
    this.analysisRequested = false;
  }

  private waitForAnalysisIdle(): Promise<void> {
    if (!this.analysisInFlight) return Promise.resolve();
    return new Promise((resolve) => {
      this.analysisIdleWaiters.push(resolve);
    });
  }

  private async generateAnalysis(): Promise<{
    todoAnalysisRan: boolean;
    todoSuggestionsEmitted: number;
    suggestions: TodoSuggestion[];
  }> {
    if (this.analysisInFlight) {
      this.analysisRequested = true;
      return {
        todoAnalysisRan: false,
        todoSuggestionsEmitted: 0,
        suggestions: [],
      };
    }

    const allBlocks = [...this.contextState.transcriptBlocks.values()];
    const now = Date.now();
    const forceTodoAnalysis = this.todoScanRequested;
    this.todoScanRequested = false;
    const hasNewAnalysisBlocks = allBlocks.length > this.lastAnalysisBlockCount;
    const shouldRunSummaryAnalysis =
      hasNewAnalysisBlocks
      && !(forceTodoAnalysis && !this.isRecording);
    const hasNewTodoBlocks = allBlocks.length > this.lastTodoAnalysisBlockCount;
    const shouldRunTodoAnalysis =
      (forceTodoAnalysis && allBlocks.length > 0)
      || (
        hasNewTodoBlocks
        && (
          // Whisper/ElevenLabs have preview text; run todo scan when a paragraph is committed.
          this.config.transcriptionProvider === "whisper"
          || this.config.transcriptionProvider === "elevenlabs"
          || now - this.lastTodoAnalysisAt >= this.todoAnalysisIntervalMs
        )
      );
    if (!shouldRunSummaryAnalysis && !shouldRunTodoAnalysis) {
      return {
        todoAnalysisRan: false,
        todoSuggestionsEmitted: 0,
        suggestions: [],
      };
    }

    // Send all blocks since last analysis, plus up to 10 earlier blocks for context continuity
    const analysisTargetBlockCount = allBlocks.length;
    const contextStart = Math.max(0, this.lastAnalysisBlockCount - 10);
    const recentBlocks = shouldRunSummaryAnalysis ? allBlocks.slice(contextStart) : [];

    this.analysisInFlight = true;
    this.analysisRequested = false;
    let analysisSucceeded = false;
    const startTime = Date.now();
    let analysisElapsedMs = 0;
    let analysisKeyPointsCount = 0;
    let analysisInsightsCount = 0;
    let todoAnalysisRan = false;
    let todoSuggestionsEmitted = 0;
    let emittedTodoSuggestions: TodoSuggestion[] = [];

    try {
      const existingTodos = this.db
        ? this.db.getTodosForSession(this.sessionId)
        : [];
      const previousKeyPoints = this.contextState.allKeyPoints.slice(-20);

      if (shouldRunSummaryAnalysis) {
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

        analysisElapsedMs = Date.now() - startTime;
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
        analysisKeyPointsCount = analysisResult.keyPoints.length;
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
        analysisInsightsCount = analysisResult.educationalInsights.length;
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
      }

      let todoSuggestions: TodoSuggestionDraft[] = [];
      let todoBlocks: typeof allBlocks = [];

      if (shouldRunTodoAnalysis) {
        todoAnalysisRan = true;
        if (forceTodoAnalysis) {
          todoBlocks = allBlocks;
        } else {
          const todoContextStart = Math.max(
            0,
            this.lastTodoAnalysisBlockCount - 10,
            analysisTargetBlockCount - this.todoAnalysisMaxBlocks,
          );
          todoBlocks = allBlocks.slice(todoContextStart, analysisTargetBlockCount);
        }
        this.lastTodoAnalysisAt = now;

        try {
          const todoPrompt = buildTodoPrompt(todoBlocks, existingTodos);
          const { object: todoResult, usage: todoUsage } = await generateObject({
            model: this.todoModel,
            schema: todoAnalysisSchema,
            prompt: todoPrompt,
            abortSignal: AbortSignal.timeout(10000),
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
          todoSuggestions = todoResult.suggestedTodos
            .map((raw) => this.normalizeTodoSuggestion(raw, todoBlocks))
            .filter((candidate): candidate is TodoSuggestionDraft => candidate !== null);
          this.lastTodoAnalysisBlockCount = analysisTargetBlockCount;
        } catch (todoError) {
          if (this.config.debug) {
            log("WARN", `Todo extraction failed: ${toReadableError(todoError)}`);
          }
        }
      }

      if (this.config.debug) {
        log("INFO", `Analysis response: ${analysisElapsedMs}ms, keyPoints=${analysisKeyPointsCount}, insights=${analysisInsightsCount}, todos=${todoSuggestions.length}`);
      }

      // Emit todo suggestions (not auto-added — user must accept)
      const existingTodoTexts = existingTodos.map((t) => t.text);
      const emittedTodoTexts: string[] = [];
      emittedTodoSuggestions = [];
      for (const candidate of todoSuggestions) {
        const emittedSuggestion = this.tryEmitTodoSuggestion(
          candidate,
          existingTodoTexts,
          emittedTodoTexts,
          forceTodoAnalysis,
        );
        if (!emittedSuggestion) {
          continue;
        }
        emittedTodoTexts.push(candidate.text);
        emittedTodoSuggestions.push(emittedSuggestion);
        todoSuggestionsEmitted += 1;
      }

      if (forceTodoAnalysis) {
        const suffix = todoSuggestionsEmitted === 1 ? "" : "s";
        this.events.emit(
          "status",
          todoAnalysisRan
            ? `Todo scan complete: ${todoSuggestionsEmitted} suggestion${suffix}.`
            : "Todo scan skipped."
        );
      }
    } catch (error) {
      if (this.config.debug) {
        log("WARN", `Analysis failed: ${toReadableError(error)}`);
      }
      if (forceTodoAnalysis) {
        this.events.emit("status", `Todo scan failed: ${toReadableError(error)}`);
      }
    } finally {
      this.analysisInFlight = false;
      const waiters = this.analysisIdleWaiters.splice(0);
      for (const resolve of waiters) {
        resolve();
      }
      const hasUnanalyzedBlocks = this.contextState.transcriptBlocks.size > this.lastAnalysisBlockCount;
      if (this.isRecording && (this.analysisRequested || hasUnanalyzedBlocks)) {
        this.analysisRequested = false;
        this.scheduleAnalysis(analysisSucceeded ? 0 : this.analysisRetryDelayMs);
      } else if (!this.isRecording && this.analysisRequested) {
        this.analysisRequested = false;
        void this.generateAnalysis();
      }
    }
    return {
      todoAnalysisRan,
      todoSuggestionsEmitted,
      suggestions: emittedTodoSuggestions,
    };
  }

  private isDuplicateTodoSuggestion(
    candidate: string,
    existingTodoTexts: readonly string[],
    emittedInCurrentAnalysis: readonly string[],
    ignoreRecentSuggestions = false,
  ): boolean {
    const normalizedCandidate = normalizeTodoText(candidate);
    if (!normalizedCandidate) return true;

    const exactMatch = (text: string) => normalizeTodoText(text) === normalizedCandidate;
    if (existingTodoTexts.some(exactMatch)) return true;
    if (emittedInCurrentAnalysis.some(exactMatch)) return true;
    if (!ignoreRecentSuggestions && this.recentSuggestedTodoTexts.some(exactMatch)) return true;

    const fuzzyMatch = (text: string) => isLikelyDuplicateTodoText(candidate, text);
    if (existingTodoTexts.some(fuzzyMatch)) return true;
    if (emittedInCurrentAnalysis.some(fuzzyMatch)) return true;
    if (!ignoreRecentSuggestions && this.recentSuggestedTodoTexts.some(fuzzyMatch)) return true;

    return false;
  }

  private tryEmitTodoSuggestion(
    candidate: TodoSuggestionDraft,
    existingTodoTexts?: readonly string[],
    emittedInCurrentAnalysis: readonly string[] = [],
    ignoreRecentSuggestions = false,
  ): TodoSuggestion | null {
    const normalized = candidate.text.trim();
    if (!normalized) return null;

    const knownTodoTexts = existingTodoTexts ?? (this.db ? this.db.getTodos().map((t) => t.text) : []);
    if (this.isDuplicateTodoSuggestion(normalized, knownTodoTexts, emittedInCurrentAnalysis, ignoreRecentSuggestions)) {
      return null;
    }

    const suggestion: TodoSuggestion = {
      id: crypto.randomUUID(),
      text: normalized,
      details: candidate.details?.trim() || undefined,
      transcriptExcerpt: candidate.transcriptExcerpt?.trim() || undefined,
      sessionId: this.sessionId,
      createdAt: Date.now(),
    };
    this.recentSuggestedTodoTexts.push(normalized);
    if (this.recentSuggestedTodoTexts.length > 500) {
      this.recentSuggestedTodoTexts = this.recentSuggestedTodoTexts.slice(-500);
    }
    this.events.emit("todo-suggested", suggestion);
    return suggestion;
  }

  private normalizeTodoSuggestion(
    rawSuggestion: TodoExtractSuggestion,
    todoBlocks: readonly TranscriptBlock[],
  ): TodoSuggestionDraft | null {
    if (typeof rawSuggestion === "string") {
      const text = rawSuggestion.trim();
      if (!text) return null;
      return {
        text,
        ...this.buildTodoSuggestionFallbackContext(text, todoBlocks),
      };
    }

    const text = rawSuggestion.todoTitle.trim();
    if (!text) return null;
    const details = rawSuggestion.todoDetails?.trim();
    const transcriptExcerpt = rawSuggestion.transcriptExcerpt?.trim();
    const fallback = this.buildTodoSuggestionFallbackContext(text, todoBlocks);
    return {
      text,
      details: details || fallback.details,
      transcriptExcerpt: transcriptExcerpt || fallback.transcriptExcerpt,
    };
  }

  private buildTodoSuggestionFallbackContext(
    todoText: string,
    todoBlocks: readonly TranscriptBlock[],
  ): Pick<TodoSuggestionDraft, "details" | "transcriptExcerpt"> {
    if (todoBlocks.length === 0) {
      return {};
    }

    const relevantBlocks = this.selectRelevantTodoBlocks(todoText, todoBlocks);
    const transcriptExcerpt = relevantBlocks
      .map((block) => {
        const source = `[${block.audioSource}] ${block.sourceText}`;
        const translation = block.translation ? ` → ${block.translation}` : "";
        return source + translation;
      })
      .join("\n")
      .trim();

    if (!transcriptExcerpt) {
      return {};
    }

    return {
      details: "Derived from live transcript scan. Preserve names, dates, places, and constraints from the excerpt.",
      transcriptExcerpt,
    };
  }

  private selectRelevantTodoBlocks(
    todoText: string,
    todoBlocks: readonly TranscriptBlock[],
  ): TranscriptBlock[] {
    if (todoBlocks.length <= 3) {
      return [...todoBlocks];
    }

    const todoTokens = normalizeTodoText(todoText)
      .split(" ")
      .filter((token) => token.length >= 3);
    if (todoTokens.length === 0) {
      return [...todoBlocks.slice(-3)];
    }

    const scored = todoBlocks
      .map((block) => {
        const searchableText = normalizeTodoText(
          `${block.sourceText} ${block.translation ?? ""}`,
        );
        const score = todoTokens.reduce((acc, token) => (
          searchableText.includes(token) ? acc + 1 : acc
        ), 0);
        return { block, score };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (right.block.createdAt !== left.block.createdAt) {
          return right.block.createdAt - left.block.createdAt;
        }
        return right.block.id - left.block.id;
      })
      .slice(0, 3)
      .map((item) => item.block);

    if (scored.length === 0) {
      return [...todoBlocks.slice(-3)];
    }

    return scored.sort((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
      return left.id - right.id;
    });
  }
}
