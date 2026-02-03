import "dotenv/config";
import WebSocket from "ws";
import { generateText, generateObject } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { createVertex } from "@ai-sdk/google-vertex";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { CliConfig, Engine, Summary } from "./types";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_INTERVAL_MS,
  DEFAULT_VERTEX_MODEL_ID,
  DEFAULT_VERTEX_LOCATION,
} from "./types";
import {
  createAudioRecorder,
  checkMacOSVersion,
  type AudioRecorder,
  // Legacy imports for --legacy-audio mode
  listAvfoundationDevices,
  selectAudioDevice,
  formatDevices,
  spawnFfmpeg,
} from "./audio";
import { type TranscriptBlock } from "./ui";
import { createBlessedUI, type BlessedUI, type UIState } from "./ui-blessed";
import {
  buildAudioPromptForStructured,
  buildPrompt,
  extractSentences,
  hasTranslatableContent,
  detectSourceLanguage,
  LANG_NAMES,
} from "./translation";
import {
  showIntroScreen,
  getLanguageLabel,
  type LanguageCode,
  type IntroSelection,
} from "./intro-screen";
import {
  pcmToWavBuffer,
  normalizeText,
  cleanTranslationOutput,
  parseArgs,
  toReadableError,
} from "./utils";

// Simple file logger
const LOG_FILE = path.join(process.cwd(), "translator.log");
function log(level: "INFO" | "ERROR" | "WARN", msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level}: ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

// Global UI reference for error display
let globalUI: BlessedUI | null = null;
let isShuttingDown = false;

function showFatalError(label: string, msg: string) {
  if (isShuttingDown) return; // Prevent recursive errors during shutdown
  isShuttingDown = true;

  const fullMsg = `${label}: ${msg}`;
  log("ERROR", fullMsg);

  if (globalUI) {
    try {
      globalUI.setStatus(`❌ ${fullMsg}`);
      globalUI.render();
    } catch {
      // UI already destroyed
    }
    // Give user time to see the error before exiting
    setTimeout(() => {
      try {
        globalUI?.destroy();
      } catch {
        // Ignore
      }
      console.error(fullMsg);
      process.exit(1);
    }, 3000);
  } else {
    console.error(fullMsg);
    process.exit(1);
  }
}

// Global error handlers to prevent silent crashes
process.on("unhandledRejection", (reason) => {
  // Check if this is an AbortError (expected from timeouts) - don't treat as fatal
  const isAbortError =
    (reason instanceof Error && reason.name === "AbortError") ||
    (reason && typeof reason === "object" && "name" in reason && reason.name === "AbortError");

  if (isAbortError) {
    log("WARN", "Unhandled AbortError (timeout) - suppressed");
    return; // Don't crash the app for expected timeouts
  }

  const msg = toReadableError(reason);
  log("ERROR", `Unhandled rejection: ${msg}`);
  showFatalError("Unhandled rejection", msg);
});

process.on("uncaughtException", (err) => {
  log("ERROR", `Uncaught exception: ${err.message}\n${err.stack}`);
  showFatalError("Uncaught exception", err.message);
});

// Log unexpected exits
process.on("exit", (code) => {
  log("INFO", `Process exiting with code ${code}`);
  if (code !== 0 && !isShuttingDown) {
    console.error(`Process exiting with code ${code}`);
  }
});

async function main() {
  const config = parseArgs(process.argv.slice(2));
  log("INFO", `Starting translator with engine=${config.engine}`);

  if (config.help) {
    printHelp();
    return;
  }

  // Legacy mode: list devices (for --legacy-audio compatibility)
  if (config.listDevices) {
    if (config.legacyAudio) {
      try {
        const devices = await listAvfoundationDevices();
        console.log(formatDevices(devices));
      } catch (error) {
        console.error(
          `Unable to list devices. Is ffmpeg installed? ${toReadableError(error)}`
        );
      }
    } else {
      console.log("Device listing not needed - using ScreenCaptureKit for system audio.");
      console.log("Add --legacy-audio flag to list AVFoundation devices.");
    }
    return;
  }

  // Check macOS version for ScreenCaptureKit support
  const { supported: macOSSupported, version: macOSVersion } = checkMacOSVersion();
  if (!config.legacyAudio && !macOSSupported) {
    console.error(`ScreenCaptureKit requires macOS 14.2 or later (detected macOS ${macOSVersion}).`);
    console.error("Use --legacy-audio flag with a loopback device (BlackHole) instead.");
    return;
  }

  // Show intro screen for language/engine selection (unless --skip-intro)
  if (!config.skipIntro) {
    const selection = await showIntroScreen();
    config.sourceLang = selection.sourceLang;
    config.targetLang = selection.targetLang;
    config.engine = selection.engine;
  }

  log("INFO", `Languages: ${config.sourceLang} → ${config.targetLang}`);

  validateEnv(config.engine, config);

  // Legacy audio mode: use ffmpeg + loopback device
  let legacyDevice: { index: number; name: string } | null = null;
  if (config.legacyAudio) {
    let devices: { index: number; name: string }[] = [];
    try {
      devices = await listAvfoundationDevices();
    } catch (error) {
      console.error(
        `Unable to list devices. Is ffmpeg installed? ${toReadableError(error)}`
      );
      return;
    }

    if (devices.length === 0) {
      console.error("No avfoundation audio devices found.");
      return;
    }

    legacyDevice = selectAudioDevice(devices, config.device);
    if (!legacyDevice) {
      console.error("No loopback device found. Use --device to override.");
      console.log(formatDevices(devices));
      return;
    }
    log("INFO", `Selected device: [${legacyDevice.index}] ${legacyDevice.name}`);
  } else {
    log("INFO", "Using ScreenCaptureKit for system audio capture");
  }

  const bedrockModel = bedrock(config.modelId);
  const vertexModel = createVertex({
    project: config.vertexProject,
    location: config.vertexLocation,
  }) as unknown as (modelId: string) => ReturnType<typeof bedrock>;

  let isRecording = false;
  let ws: WebSocket | null = null;
  let audioRecorder: AudioRecorder | null = null;
  let ffmpegProcess: ReturnType<typeof spawnFfmpeg> | null = null; // Legacy mode only
  let audioBuffer = Buffer.alloc(0);
  let vertexBuffer = Buffer.alloc(0);
  let recordingStartedAt: number | null = null;
  let audioBytesSent = 0;
  let noAudioTimer: NodeJS.Timeout | null = null;
  let audioWarningShown = false;
  let vertexFlushTimer: NodeJS.Timeout | null = null;
  let vertexChunkQueue: Buffer[] = [];
  let vertexInFlight = 0;
  const vertexMaxConcurrency = 5;
  const vertexMaxQueueSize = 20;
  let vertexOverlap = Buffer.alloc(0);

  const recentTranslationLimit = 20;
  const recentTranslations = new Set<string>();
  const recentTranslationQueue: string[] = [];
  const maxSentencesPerFlush = 1;
  const contextWindowSize = 10;
  const contextBuffer: string[] = [];
  const userContext = loadUserContext(config);
  const transcriptBlocks = new Map<number, TranscriptBlock>();
  const inFlightBlockIds = new Set<number>();
  let nextBlockId = 1;
  let transcriptBuffer = "";
  let lastCommittedText = "";
  let flushTimer: NodeJS.Timeout | null = null;
  let commitTimer: NodeJS.Timeout | null = null;
  let lastFlushAt = Date.now();
  let lastVertexTranscript = "";

  // Blessed UI
  let ui: BlessedUI | null = null;
  let summaryTimer: NodeJS.Timeout | null = null;
  let lastSummary: Summary | null = null;
  let summaryInFlight = false;
  const allKeyPoints: string[] = []; // Accumulated key points for log output

  // Zod schema for structured Vertex AI responses
  const sourceLangLabel = getLanguageLabel(config.sourceLang);
  const targetLangLabel = getLanguageLabel(config.targetLang);
  const sourceLangName = LANG_NAMES[config.sourceLang];
  const targetLangName = LANG_NAMES[config.targetLang];
  const AudioTranscriptionSchema = z.object({
    sourceLanguage: z
      .enum([config.sourceLang, config.targetLang] as [string, string])
      .describe(`The detected language: "${config.sourceLang}" for ${sourceLangName} or "${config.targetLang}" for ${targetLangName}`),
    transcript: z
      .string()
      .describe("The transcription of the audio in the original language"),
    translation: z
      .string()
      .optional()
      .describe(`The translation. Empty if audio matches target language (${targetLangName}).`),
    isPartial: z
      .boolean()
      .describe(
        "True if the audio was cut off mid-sentence (incomplete thought). False if speech ends at a natural sentence boundary or pause."
      ),
  });

  // Zod schema for conversation summary
  const SummarySchema = z.object({
    keyPoints: z.array(z.string()).describe("3-4 key points from the recent conversation"),
  });

  async function generateSummary() {
    if (summaryInFlight) return;

    // Filter blocks from last 30 seconds
    const windowStart = Date.now() - 30000;
    const recentBlocks = [...transcriptBlocks.values()].filter(
      (b) => b.createdAt >= windowStart
    );
    if (recentBlocks.length < 2) return; // Not enough content to summarize

    summaryInFlight = true;
    const startTime = Date.now();
    try {
      const text = recentBlocks
        .map((b) => `${b.sourceLabel}: ${b.sourceText}${b.translation ? ` → ${b.targetLabel}: ${b.translation}` : ""}`)
        .join("\n");

      const result = await generateObject({
        model: vertexModel(config.vertexModelId),
        schema: SummarySchema,
        prompt: `Summarize this conversation in 3-4 bullets:\n\n${text}`,
        abortSignal: AbortSignal.timeout(10000),
        temperature: 0,
      });

      const elapsed = Date.now() - startTime;
      if (config.debug) {
        log("INFO", `Summary response: ${elapsed}ms`);
      }

      // Append all points to session log
      allKeyPoints.push(...result.object.keyPoints);

      lastSummary = {
        keyPoints: result.object.keyPoints,
        updatedAt: Date.now(),
      };
      if (ui) {
        ui.updateSummary(lastSummary);
      }
    } catch {
      // Silent fail for summary generation
    } finally {
      summaryInFlight = false;
    }
  }

  function startSummaryTimer() {
    if (summaryTimer) clearInterval(summaryTimer);
    summaryTimer = setInterval(() => {
      if (!isRecording) return;
      void generateSummary();
    }, 30000); // Generate summary every 30 seconds
  }

  function stopSummaryTimer() {
    if (summaryTimer) {
      clearInterval(summaryTimer);
      summaryTimer = null;
    }
  }

  function loadUserContext(config: CliConfig) {
    if (!config.useContext) return "";
    const fullPath = path.resolve(config.contextFile);
    if (!fs.existsSync(fullPath)) return "";
    const raw = fs.readFileSync(fullPath, "utf-8");
    return raw
      .split("\n")
      .map((line) => line.replace(/^\s*#+\s*/, "").trim())
      .filter(Boolean)
      .join("\n");
  }

  function rememberTranslation(text: string) {
    const normalized = normalizeText(text);
    if (!normalized) return false;
    if (recentTranslations.has(normalized)) return false;
    recentTranslations.add(normalized);
    recentTranslationQueue.push(normalized);
    if (recentTranslationQueue.length > recentTranslationLimit) {
      const oldest = recentTranslationQueue.shift();
      if (oldest) recentTranslations.delete(oldest);
    }
    return true;
  }

  function getUIState(status: UIState["status"]): UIState {
    const activeModelId =
      config.engine === "vertex" ? config.vertexModelId : config.modelId;
    const engineLabel = config.engine === "vertex" ? "Vertex" : "ElevenLabs";
    const langPair = `${sourceLangName} → ${targetLangName}`;
    const deviceName = config.legacyAudio && legacyDevice
      ? legacyDevice.name
      : "System Audio (ScreenCaptureKit)";
    return {
      deviceName,
      modelId: `${langPair} | ${activeModelId} (${engineLabel})`,
      intervalMs: config.intervalMs,
      status,
      contextLoaded: !!userContext,
    };
  }

  function flushBufferIfNeeded(force: boolean) {
    if (!transcriptBuffer.trim()) return;
    const now = Date.now();
    const hasSentenceBoundary = /[.!?。！？]/.test(transcriptBuffer);
    if (
      force ||
      hasSentenceBoundary ||
      now - lastFlushAt >= config.intervalMs
    ) {
      lastFlushAt = now;
      flushTranscriptBuffer();
    }
  }

  async function translateAndPrint(
    blockId: number,
    text: string,
    detectedLang: LanguageCode,
    context: string[]
  ) {
    // Determine translation direction based on detected language
    const fromLang = detectedLang;
    const toLang = detectedLang === config.sourceLang ? config.targetLang : config.sourceLang;

    const startTime = Date.now();
    try {
      const prompt = buildPrompt(text, fromLang, toLang, context);
      const result = await generateText({
        model: bedrockModel,
        system: userContext || undefined,
        prompt,
        temperature: 0,
        maxOutputTokens: 100,
      });

      const elapsed = Date.now() - startTime;
      if (config.debug) {
        log("INFO", `Bedrock response: ${elapsed}ms`);
      }

      const translated = cleanTranslationOutput(result.text);
      if (translated) {
        const block = transcriptBlocks.get(blockId);
        if (!block) return;
        block.translation = translated;
        if (ui) ui.updateBlock(block);
      }
    } catch {
      // Silent fail
    }
  }

  function createBlock(
    sourceLabel: string,
    sourceText: string,
    targetLabel: string,
    translation?: string
  ) {
    const block: TranscriptBlock = {
      id: nextBlockId,
      sourceLabel,
      sourceText,
      targetLabel,
      translation,
      createdAt: Date.now(),
    };
    transcriptBlocks.set(nextBlockId, block);
    nextBlockId += 1;
    if (ui) ui.addBlock(block);
    return block;
  }

  function recordContext(sentence: string) {
    contextBuffer.push(sentence);
    if (contextBuffer.length > contextWindowSize) {
      contextBuffer.shift();
    }
  }

  function flushSentence(text: string) {
    const sentence = normalizeText(text);
    if (!hasTranslatableContent(sentence)) return;
    if (!rememberTranslation(sentence)) return;

    const detectedLang = detectSourceLanguage(sentence, config.sourceLang, config.targetLang);
    const sourceLabel = getLanguageLabel(detectedLang);
    const targetLabel = detectedLang === config.sourceLang ? targetLangLabel : sourceLangLabel;
    const context = contextBuffer.slice(-contextWindowSize);

    const block = createBlock(sourceLabel, sentence, targetLabel);
    recordContext(sentence);
    void translateAndPrint(block.id, sentence, detectedLang, context);
  }

  function flushTranscriptBuffer() {
    const chunk = normalizeText(transcriptBuffer);
    if (!chunk) return;
    transcriptBuffer = "";
    flushSentence(chunk);
  }

  function handleCommittedTranscript(text: string) {
    const normalized = normalizeText(text);
    if (!normalized) return;
    if (!hasTranslatableContent(normalized)) return;

    let incoming = normalized;
    if (lastCommittedText && normalized.startsWith(lastCommittedText)) {
      incoming = normalizeText(normalized.slice(lastCommittedText.length));
    }
    lastCommittedText = normalized;

    if (!incoming) return;

    transcriptBuffer = transcriptBuffer
      ? `${transcriptBuffer} ${incoming}`
      : incoming;

    const { sentences, remainder } = extractSentences(transcriptBuffer);
    if (sentences.length) {
      const toFlush = sentences.slice(0, maxSentencesPerFlush);
      for (const sentence of toFlush) {
        flushSentence(sentence);
      }
      const leftover = sentences.slice(maxSentencesPerFlush);
      transcriptBuffer = [...leftover, remainder]
        .filter(Boolean)
        .join(" ")
        .trim();
    } else {
      transcriptBuffer = remainder;
    }
  }

  async function connectScribe() {
    const url =
      "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime";
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
      });
      let ready = false;
      const sessionTimeout = setTimeout(() => {
        if (ready) return;
        socket.close();
        reject(new Error("Scribe timeout"));
      }, 7000);

      socket.on("message", (raw) => {
        let msg: { message_type?: string; text?: string };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (msg.message_type === "session_started" && !ready) {
          ready = true;
          clearTimeout(sessionTimeout);
          resolve(socket);
        } else if (
          msg.message_type === "committed_transcript" ||
          msg.message_type === "committed_transcript_with_timestamps"
        ) {
          handleCommittedTranscript(msg.text ?? "");
        }
      });

      socket.on("error", (err) => {
        clearTimeout(sessionTimeout);
        if (!ready) reject(err);
      });

      socket.on("close", () => clearTimeout(sessionTimeout));
    });
  }

  function sendAudioChunk(chunk: Buffer) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    audioBytesSent += chunk.length;
    ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: chunk.toString("base64"),
        commit: false,
        sample_rate: 16000,
      })
    );
  }

  function shouldStreamToScribe(): boolean {
    return config.engine === "elevenlabs";
  }

  function isAudioSilent(pcmBuffer: Buffer, threshold = 200): boolean {
    // 16-bit PCM: 2 bytes per sample, little-endian signed
    const samples = pcmBuffer.length / 2;
    if (samples === 0) return true;

    let sumSquares = 0;
    for (let i = 0; i < pcmBuffer.length; i += 2) {
      const sample = pcmBuffer.readInt16LE(i);
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / samples);
    return rms < threshold;
  }

  function enqueueVertexChunk(chunk: Buffer) {
    if (!chunk.length) return;
    const overlapBytes = Math.floor(16000 * 2 * 0.5); // 0.5s overlap
    const overlap = vertexOverlap.subarray(0, overlapBytes);
    const combined = overlap.length ? Buffer.concat([overlap, chunk]) : chunk;

    // Drop oldest chunks if queue is full to stay real-time
    while (vertexChunkQueue.length >= vertexMaxQueueSize) {
      vertexChunkQueue.shift();
      log("WARN", `Dropped oldest chunk, queue was at ${vertexMaxQueueSize}`);
    }

    vertexChunkQueue.push(combined);
    vertexOverlap = Buffer.from(
      chunk.subarray(Math.max(0, chunk.length - overlapBytes))
    );
  }

  function updateBlock(block: TranscriptBlock, updates: Partial<TranscriptBlock>) {
    Object.assign(block, updates);
    if (ui) ui.updateBlock(block);
  }

  function updateInFlightDisplay() {
    if (inFlightBlockIds.size === 0) return;
    const maxId = Math.max(...inFlightBlockIds);
    for (const id of inFlightBlockIds) {
      const b = transcriptBlocks.get(id);
      if (!b) continue;
      // Skip if block already has real content (not empty or placeholder)
      if (b.sourceText && b.sourceText !== "" && b.sourceText !== "Processing...") continue;
      // Show "Processing..." only if not the last in-flight block
      const displayText = id < maxId ? "Processing..." : "";
      if (b.sourceText !== displayText) {
        b.sourceText = displayText;
        if (ui) ui.updateBlock(b);
      }
    }
  }

  async function processVertexQueue() {
    if (vertexInFlight >= vertexMaxConcurrency || vertexChunkQueue.length === 0) return;
    const chunk = vertexChunkQueue.shift();
    if (!chunk) return;
    vertexInFlight++;

    // Create block with empty text initially (will show nothing for trailing block)
    const block = createBlock(sourceLangLabel, "", targetLangLabel, undefined);
    inFlightBlockIds.add(block.id);
    updateInFlightDisplay(); // Update all in-flight blocks' display

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
    const startTime = Date.now();

    try {
      const prompt = buildAudioPromptForStructured(
        config.direction,
        config.sourceLang,
        config.targetLang,
        contextBuffer.slice(-contextWindowSize)
      );
      const wavBuffer = pcmToWavBuffer(chunk, 16000);

      const { object: result, usage: finalUsage } = await generateObject({
        model: vertexModel(config.vertexModelId),
        schema: AudioTranscriptionSchema,
        system: userContext || undefined,
        temperature: 0,
        abortSignal: controller.signal,
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
      clearTimeout(timeoutId);

      const elapsed = Date.now() - startTime;
      const inTok = finalUsage?.inputTokens ?? 0;
      const outTok = finalUsage?.outputTokens ?? 0;
      if (config.debug) {
        log("INFO", `Vertex response: ${elapsed}ms, tokens: ${inTok}→${outTok}, queue: ${vertexChunkQueue.length}`);
        if (ui) ui.setStatus(`Response: ${elapsed}ms | T: ${inTok}→${outTok}`);
      }

      const transcript = result.transcript?.trim() ?? "";
      const translation = result.translation?.trim() ?? "";
      const detectedLang = result.sourceLanguage as LanguageCode;

      if (!translation && !transcript) {
        updateBlock(block, {
          sourceText: "(Vertex returned empty response)",
          translation: "(no content)",
        });
        return;
      }

      const sourceText = transcript || "(unavailable)";
      const isTargetLang = detectedLang === config.targetLang;
      const detectedLabel = getLanguageLabel(detectedLang);
      const translatedToLabel = isTargetLang ? sourceLangLabel : targetLangLabel;

      if (isTargetLang) {
        // Already in target language: transcription only, no translation needed
        updateBlock(block, {
          sourceLabel: detectedLabel,
          sourceText,
          targetLabel: detectedLabel,
          translation: undefined,
          partial: result.isPartial,
        });
      } else {
        // Source language detected: show translation to target
        updateBlock(block, {
          sourceLabel: detectedLabel,
          sourceText,
          targetLabel: translatedToLabel,
          translation: translation || undefined,
          partial: result.isPartial,
        });
      }

      if (sourceText && hasTranslatableContent(sourceText)) {
        recordContext(sourceText);
      } else if (translation && hasTranslatableContent(translation)) {
        recordContext(translation);
      }
      lastVertexTranscript = transcript;
    } catch (error) {
      clearTimeout(timeoutId);
      const isAbortError =
        (error instanceof Error && error.name === "AbortError") ||
        (error && typeof error === "object" && "name" in error && error.name === "AbortError");
      const errorMsg = isAbortError ? "Request timed out (15s)" : toReadableError(error);
      const fullError = error instanceof Error ? `${error.name}: ${error.message}` : toReadableError(error);
      log("ERROR", `Vertex chunk failed: ${fullError}`);
      updateBlock(block, {
        sourceText: "(Vertex error)",
        translation: errorMsg,
      });
    } finally {
      inFlightBlockIds.delete(block.id);
      updateInFlightDisplay(); // Re-render remaining blocks
      vertexInFlight--;
      // Trigger next chunk if queue has items and we have capacity
      if (vertexChunkQueue.length && vertexInFlight < vertexMaxConcurrency) {
        void processVertexQueue();
      }
    }
  }

  function attachAudioStream(stream: NodeJS.ReadableStream) {
    stream.on("data", (data: Buffer) => {
      handleAudioData(data);
    });
  }

  // Shared audio processing logic for both ScreenCaptureKit and legacy ffmpeg modes
  const scribeChunkSize = 3200;
  const vertexChunkBytes = Math.floor(16000 * 2 * (config.intervalMs / 1000));

  function handleAudioData(data: Buffer) {
    if (shouldStreamToScribe()) {
      audioBuffer = Buffer.concat([audioBuffer, data]);
      while (audioBuffer.length >= scribeChunkSize) {
        sendAudioChunk(audioBuffer.subarray(0, scribeChunkSize));
        audioBuffer = audioBuffer.subarray(scribeChunkSize);
      }
    }

    if (config.engine === "vertex") {
      vertexBuffer = Buffer.concat([vertexBuffer, data]);
      while (vertexBuffer.length >= vertexChunkBytes) {
        const chunk = vertexBuffer.subarray(0, vertexChunkBytes);
        vertexBuffer = vertexBuffer.subarray(vertexChunkBytes);
        if (isAudioSilent(chunk)) {
          continue;
        }
        enqueueVertexChunk(chunk);
        void processVertexQueue();
      }
    }
  }

  function startNoAudioTimer() {
    noAudioTimer = setInterval(() => {
      if (!isRecording || audioWarningShown) return;
      if (!shouldStreamToScribe()) return;
      if (audioBytesSent > 0) return;
      if (!recordingStartedAt || Date.now() - recordingStartedAt < 3000) return;
      audioWarningShown = true;
      if (ui) {
        ui.setStatus("⚠️ No audio - check Sound settings");
      }
    }, 1000);
  }

  function startFlushTimer() {
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = setInterval(() => {
      if (!isRecording) return;
      if (!shouldStreamToScribe()) return;
      const now = Date.now();
      if (now - lastFlushAt < config.intervalMs) return;
      lastFlushAt = now;
      flushBufferIfNeeded(false);
    }, Math.max(200, Math.floor(config.intervalMs / 2)));
  }

  function stopFlushTimer() {
    if (!flushTimer) return;
    clearInterval(flushTimer);
    flushTimer = null;
  }

  function sendCommit() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: "",
        commit: true,
        sample_rate: 16000,
      })
    );
  }

  function startCommitTimer() {
    if (commitTimer) clearInterval(commitTimer);
    commitTimer = setInterval(() => {
      if (!isRecording) return;
      if (!shouldStreamToScribe()) return;
      sendCommit();
    }, config.intervalMs);
  }

  function stopCommitTimer() {
    if (!commitTimer) return;
    clearInterval(commitTimer);
    commitTimer = null;
  }

  async function startRecording() {
    if (isRecording) return;
    isRecording = true;
    recordingStartedAt = Date.now();
    audioBytesSent = 0;
    audioWarningShown = false;
    audioBuffer = Buffer.alloc(0);
    transcriptBuffer = "";
    lastCommittedText = "";
    contextBuffer.length = 0;
    transcriptBlocks.clear();
    nextBlockId = 1;
    lastFlushAt = Date.now();
    lastSummary = null;

    if (ui) {
      ui.clearBlocks();
      ui.updateSummary(null);
      ui.updateHeader(getUIState("connecting"));
      ui.setStatus("Connecting...");
    }

    if (shouldStreamToScribe()) {
      try {
        ws = await connectScribe();
        // Handle post-connection WebSocket events
        ws.on("error", (err) => {
          if (ui) ui.setStatus(`WebSocket error: ${err.message}`);
        });
        ws.on("close", (code, reason) => {
          if (isRecording && ui) {
            ui.setStatus(`WebSocket closed: ${code} ${reason?.toString() || ""}`);
          }
        });
        if (ui) {
          ui.updateHeader(getUIState("recording"));
          ui.setStatus("Streaming. Speak now.");
        }
      } catch (error) {
        isRecording = false;
        if (ui) ui.setStatus(`Connection error: ${toReadableError(error)}`);
        return;
      }
    } else {
      if (ui) {
        ui.updateHeader(getUIState("recording"));
        ui.setStatus("Streaming. Speak now.");
      }
    }

    // Start audio capture (ScreenCaptureKit or legacy ffmpeg)
    if (config.legacyAudio && legacyDevice) {
      // Legacy mode: use ffmpeg + loopback device
      try {
        ffmpegProcess = spawnFfmpeg(legacyDevice.index);
      } catch (error) {
        isRecording = false;
        if (ui) ui.setStatus(`ffmpeg error: ${toReadableError(error)}`);
        return;
      }

      if (!ffmpegProcess.stdout) {
        isRecording = false;
        if (ui) ui.setStatus("ffmpeg failed");
        return;
      }

      attachAudioStream(ffmpegProcess.stdout);

      // Capture ffmpeg errors
      ffmpegProcess.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          log("WARN", `ffmpeg stderr: ${msg}`);
          if (ui) ui.setStatus(`ffmpeg: ${msg.slice(0, 80)}`);
        }
      });

      ffmpegProcess.on("error", (err) => {
        log("ERROR", `ffmpeg error: ${err.message}`);
        if (ui) ui.setStatus(`ffmpeg error: ${err.message}`);
      });

      ffmpegProcess.on("close", (code, signal) => {
        log("WARN", `ffmpeg closed: code=${code} signal=${signal}`);
        if (code !== 0 && code !== null && isRecording) {
          const msg = `ffmpeg exited with code ${code}`;
          log("ERROR", msg);
          if (ui) {
            ui.setStatus(`❌ ${msg} - check translator.log`);
            ui.render();
          }
        }
      });
    } else {
      // ScreenCaptureKit mode: direct system audio capture
      try {
        audioRecorder = createAudioRecorder(16000);
        audioRecorder.on("data", (data) => {
          handleAudioData(data as Buffer);
        });
        audioRecorder.on("error", (err) => {
          const error = err as Error;
          log("ERROR", `Audio capture error: ${error.message}`);
          if (ui) ui.setStatus(`Audio error: ${error.message}`);
        });
        await audioRecorder.start();
      } catch (error) {
        isRecording = false;
        const msg = toReadableError(error);
        log("ERROR", `ScreenCaptureKit error: ${msg}`);
        if (ui) ui.setStatus(`Audio capture error: ${msg}`);
        return;
      }
    }

    startNoAudioTimer();
    startFlushTimer();
    startCommitTimer();
    startSummaryTimer();
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    if (noAudioTimer) {
      clearInterval(noAudioTimer);
      noAudioTimer = null;
    }

    stopFlushTimer();
    stopCommitTimer();
    stopSummaryTimer();
    flushBufferIfNeeded(true);

    // Stop audio capture
    if (audioRecorder) {
      audioRecorder.stop();
      audioRecorder = null;
    }
    if (ffmpegProcess) {
      ffmpegProcess.kill("SIGTERM");
      ffmpegProcess = null;
    }

    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        sendCommit();
      }
      ws.close();
      ws = null;
    }

    vertexChunkQueue = [];
    vertexBuffer = Buffer.alloc(0);
    vertexOverlap = Buffer.alloc(0);
    vertexInFlight = 0;
    inFlightBlockIds.clear();

    if (ui) {
      ui.updateHeader(getUIState("paused"));
      ui.setStatus("Paused. SPACE to resume, Q to quit.");
    }
  }

  function shutdown(reason = "unknown") {
    log("INFO", `Shutdown called: ${reason}`);
    if (isRecording) stopRecording();

    // Write accumulated key points to summary.log
    if (allKeyPoints.length > 0) {
      const summaryLogFile = path.join(process.cwd(), "summary.log");
      const ts = new Date().toISOString();
      const lines = [
        `\n--- Session: ${ts} ---`,
        ...allKeyPoints.map((p) => `• ${p}`),
        "",
      ].join("\n");
      fs.appendFileSync(summaryLogFile, lines);
      log("INFO", `Wrote ${allKeyPoints.length} key points to summary.log`);
    }

    if (ui) ui.destroy();
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));

  // Initialize blessed UI
  try {
    ui = createBlessedUI();
    globalUI = ui; // Make available for global error handlers
    ui.updateHeader(getUIState("idle"));
    ui.render();

    // Set up blessed key handlers
    ui.screen.key(["q", "C-c"], () => shutdown("blessed key q/C-c"));
    ui.screen.key(["space"], () => {
      if (isRecording) stopRecording();
      else void startRecording();
    });
  } catch (error) {
    console.error(`Failed to initialize UI: ${toReadableError(error)}`);
    process.exit(1);
  }

  await startRecording();
}

function printHelp() {
  console.log(`Usage: bun run src/index.ts [options]

Options:
  --source-lang <code>       Input language code (default: ko)
  --target-lang <code>       Output language code (default: en)
  --skip-intro               Skip language selection screen, use CLI values
  --direction auto|source-target  Detection mode (default: auto)
  --model <bedrock-id>       Default: ${DEFAULT_MODEL_ID}
  --engine vertex|elevenlabs Default: vertex
  --vertex-model <id>        Default: ${DEFAULT_VERTEX_MODEL_ID}
  --vertex-project <id>      Default: $GOOGLE_VERTEX_PROJECT_ID
  --vertex-location <id>     Default: ${DEFAULT_VERTEX_LOCATION}
  --context-file <path>      Default: context.md
  --no-context               Disable context.md injection
  --compact                  Less vertical spacing
  --debug                    Log API response times to translator.log
  --legacy-audio             Use ffmpeg + loopback device (BlackHole) instead of ScreenCaptureKit
  --device <name|index>      Audio device for legacy mode (auto-detects BlackHole)
  --list-devices             List audio devices (legacy mode only)
  -h, --help

Supported languages: en, es, fr, de, it, pt, zh, ja, ko, ar, hi, ru

Controls: SPACE start/pause, Q quit

Requires: macOS 14.2+ for ScreenCaptureKit (or use --legacy-audio with BlackHole)

Env: ELEVENLABS_API_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
     GOOGLE_APPLICATION_CREDENTIALS (Vertex)
     GOOGLE_VERTEX_PROJECT_ID, GOOGLE_VERTEX_PROJECT_LOCATION
`);
}

function validateEnv(engine: Engine, config: CliConfig) {
  const missing: string[] = [];

  if (engine === "elevenlabs") {
    if (!process.env.ELEVENLABS_API_KEY) missing.push("ELEVENLABS_API_KEY");
    if (!process.env.AWS_ACCESS_KEY_ID) missing.push("AWS_ACCESS_KEY_ID");
    if (!process.env.AWS_SECRET_ACCESS_KEY)
      missing.push("AWS_SECRET_ACCESS_KEY");
    if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION)
      missing.push("AWS_REGION");
  }

  if (engine === "vertex") {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      missing.push("GOOGLE_APPLICATION_CREDENTIALS");
    }
    if (!process.env.GOOGLE_VERTEX_PROJECT_ID && !config.vertexProject) {
      missing.push("GOOGLE_VERTEX_PROJECT_ID");
    }
    if (!process.env.GOOGLE_VERTEX_PROJECT_LOCATION && !config.vertexLocation) {
      missing.push("GOOGLE_VERTEX_PROJECT_LOCATION");
    }
  }

  if (missing.length) {
    console.error(`Missing: ${missing.join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  showFatalError("Fatal", toReadableError(e));
});
