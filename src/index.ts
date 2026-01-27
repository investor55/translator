import "dotenv/config";
import WebSocket from "ws";
import { generateText, generateObject, streamObject } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { createVertex } from "@ai-sdk/google-vertex";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { CliConfig, Device, Engine, FixedDirection, Summary } from "./types";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_INTERVAL_MS,
  DEFAULT_VERTEX_MODEL_ID,
  DEFAULT_VERTEX_LOCATION,
} from "./types";
import {
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
  resolveDirection,
} from "./translation";
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

  if (config.listDevices) {
    try {
      const devices = await listAvfoundationDevices();
      console.log(formatDevices(devices));
    } catch (error) {
      console.error(
        `Unable to list devices. Is ffmpeg installed? ${toReadableError(error)}`
      );
    }
    return;
  }

  validateEnv(config.engine, config);

  let devices: Device[] = [];
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

  const device = selectAudioDevice(devices, config.device);
  if (!device) {
    console.error("No loopback device found. Use --device to override.");
    console.log(formatDevices(devices));
    return;
  }
  log("INFO", `Selected device: [${device.index}] ${device.name}`);

  const bedrockModel = bedrock(config.modelId);
  const vertexModel = createVertex({
    project: config.vertexProject,
    location: config.vertexLocation,
  }) as unknown as (modelId: string) => ReturnType<typeof bedrock>;

  let isRecording = false;
  let ws: WebSocket | null = null;
  let ffmpegProcess: ReturnType<typeof spawnFfmpeg> | null = null;
  let audioBuffer = Buffer.alloc(0);
  let vertexBuffer = Buffer.alloc(0);
  let recordingStartedAt: number | null = null;
  let audioBytesSent = 0;
  let noAudioTimer: NodeJS.Timeout | null = null;
  let audioWarningShown = false;
  let vertexFlushTimer: NodeJS.Timeout | null = null;
  let vertexChunkQueue: Buffer[] = [];
  let vertexInFlight = 0;
  const vertexMaxConcurrency = 3;
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
  const AudioTranscriptionSchema = z.object({
    sourceLanguage: z
      .enum(["ko", "en"])
      .describe("The detected language of the audio: 'ko' for Korean, 'en' for English"),
    transcript: z
      .string()
      .describe("The transcription of the audio in the original language"),
    translation: z
      .string()
      .describe("The translation of the transcript into the target language"),
  });

  // Zod schema for conversation summary
  const SummarySchema = z.object({
    keyPoints: z.array(z.string()).describe("3-4 key points from the recent conversation"),
  });

  async function generateSummary() {
    if (summaryInFlight) return;

    // Filter blocks from last 3 minutes (180000ms)
    const threeMinutesAgo = Date.now() - 180000;
    const recentBlocks = [...transcriptBlocks.values()].filter(
      (b) => b.createdAt >= threeMinutesAgo
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
        prompt: `Extract 3-4 key points from this recent conversation (last 3 minutes). Focus on important information, decisions, or topics discussed:\n\n${text}`,
        abortSignal: AbortSignal.timeout(10000),
        temperature: 0,
      });

      const elapsed = Date.now() - startTime;
      if (config.debug) {
        log("INFO", `Summary response: ${elapsed}ms`);
      }

      // Accumulate new key points (deduplicated)
      for (const point of result.object.keyPoints) {
        if (!allKeyPoints.includes(point)) {
          allKeyPoints.push(point);
        }
      }

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
    return {
      deviceName: device.name,
      modelId: `${activeModelId} (${engineLabel})`,
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
    direction: FixedDirection,
    context: string[]
  ) {
    const startTime = Date.now();
    try {
      const prompt = buildPrompt(text, direction, context);
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
    } catch (error) {
      // Silent fail
    }
  }

  function createBlock(
    sourceLabel: "KR" | "EN",
    sourceText: string,
    targetLabel: "KR" | "EN",
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

    const direction = resolveDirection(sentence, config.direction);
    const sourceLabel = direction === "ko-en" ? "KR" : "EN";
    const targetLabel = direction === "ko-en" ? "EN" : "KR";
    const context = contextBuffer.slice(-contextWindowSize);

    const block = createBlock(sourceLabel, sentence, targetLabel);
    recordContext(sentence);
    void translateAndPrint(block.id, sentence, direction, context);
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

  function enqueueVertexChunk(chunk: Buffer) {
    if (!chunk.length) return;
    const overlapBytes = Math.floor(16000 * 2 * 0.5); // 0.5s overlap
    const overlap = vertexOverlap.subarray(0, overlapBytes);
    const combined = overlap.length ? Buffer.concat([overlap, chunk]) : chunk;
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
    const block = createBlock("EN", "", "KR", undefined);
    inFlightBlockIds.add(block.id);
    updateInFlightDisplay(); // Update all in-flight blocks' display

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
    const startTime = Date.now();

    try {
      const prompt = buildAudioPromptForStructured(
        config.direction,
        contextBuffer.slice(-contextWindowSize)
      );
      const wavBuffer = pcmToWavBuffer(chunk, 16000);

      const { partialObjectStream, object, usage } = streamObject({
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

      // Stream partial updates to UI
      let partialCount = 0;
      let firstTokenAt: number | null = null;
      let lastTokenAt: number | null = null;
      for await (const partial of partialObjectStream) {
        const now = Date.now();
        if (firstTokenAt === null) firstTokenAt = now;
        lastTokenAt = now;
        partialCount++;
        if (partial.transcript || partial.translation) {
          const sourceLabel =
            partial.sourceLanguage === "ko" ? "KR" : partial.sourceLanguage === "en" ? "EN" : "EN";
          const targetLabel = sourceLabel === "KR" ? "EN" : "KR";
          updateBlock(block, {
            sourceLabel,
            sourceText: partial.transcript ?? "...",
            targetLabel,
            translation: partial.translation,
          });
        }
      }

      // Get final result and usage
      const result = await object;
      const finalUsage = await usage;
      clearTimeout(timeoutId);

      const elapsed = Date.now() - startTime;
      const ttft = firstTokenAt ? firstTokenAt - startTime : 0;
      const streamDuration = firstTokenAt && lastTokenAt ? lastTokenAt - firstTokenAt : 0;
      const inTok = finalUsage?.inputTokens ?? 0;
      const outTok = finalUsage?.outputTokens ?? 0;
      if (config.debug) {
        log("INFO", `Vertex stream: total=${elapsed}ms, TTFT=${ttft}ms, stream=${streamDuration}ms, chunks=${partialCount}, tokens: ${inTok}→${outTok}, queue: ${vertexChunkQueue.length}`);
        if (ui) ui.setStatus(`TTFT: ${ttft}ms | Stream: ${streamDuration}ms (${partialCount} chunks) | T: ${inTok}→${outTok}`);
      }

      const transcript = result.transcript?.trim() ?? "";
      const translation = result.translation?.trim() ?? "";
      const sourceLanguage = result.sourceLanguage;

      if (!translation && !transcript) {
        updateBlock(block, {
          sourceText: "(Vertex returned empty response)",
          translation: "(no content)",
        });
        return;
      }

      const sourceLabel =
        sourceLanguage === "ko" ? "KR" : sourceLanguage === "en" ? "EN" : "EN";
      const targetLabel = sourceLabel === "KR" ? "EN" : "KR";
      const sourceText = transcript || "(unavailable)";

      updateBlock(block, {
        sourceLabel,
        sourceText,
        targetLabel,
        translation: translation || undefined,
      });

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
    const chunkSize = 3200;
    const vertexChunkBytes = Math.floor(16000 * 2 * (config.intervalMs / 1000));
    stream.on("data", (data: Buffer) => {
      if (shouldStreamToScribe()) {
        audioBuffer = Buffer.concat([audioBuffer, data]);
        while (audioBuffer.length >= chunkSize) {
          sendAudioChunk(audioBuffer.subarray(0, chunkSize));
          audioBuffer = audioBuffer.subarray(chunkSize);
        }
      }

      if (config.engine === "vertex") {
        vertexBuffer = Buffer.concat([vertexBuffer, data]);
        while (vertexBuffer.length >= vertexChunkBytes) {
          const chunk = vertexBuffer.subarray(0, vertexChunkBytes);
          vertexBuffer = vertexBuffer.subarray(vertexChunkBytes);
          enqueueVertexChunk(chunk);
          void processVertexQueue();
        }
      }
    });
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

    try {
      ffmpegProcess = spawnFfmpeg(device.index);
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
        // Don't exit - let user see the error
      }
    });

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
  --device <name|index>      Audio device (auto-detects BlackHole)
  --direction auto|ko-en|en-ko
  --model <bedrock-id>       Default: ${DEFAULT_MODEL_ID}
  --engine elevenlabs|vertex Default: elevenlabs
  --vertex-model <id>        Default: ${DEFAULT_VERTEX_MODEL_ID}
  --vertex-project <id>      Default: $GOOGLE_VERTEX_PROJECT_ID
  --vertex-location <id>     Default: ${DEFAULT_VERTEX_LOCATION}
  --context-file <path>      Default: context.md
  --no-context               Disable context.md injection
  --compact                  Less vertical spacing
  --debug                    Log API response times to translator.log
  --list-devices             List audio devices
  -h, --help

Controls: SPACE start/pause, Q quit

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
