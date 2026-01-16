import "dotenv/config";
import WebSocket from "ws";
import { generateText } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { createVertex } from "@ai-sdk/google-vertex";
import readline from "readline";
import fs from "node:fs";
import path from "node:path";

import type { CliConfig, Device, Engine, FixedDirection } from "./types";
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
import {
  clearScreen,
  enterFullscreen,
  exitFullscreen,
  printHeader,
  printStatus,
  printBlock,
  type TranscriptBlock,
} from "./ui";
import {
  buildAudioPrompt,
  buildPrompt,
  extractSentences,
  hasTranslatableContent,
  resolveDirection,
} from "./translation";

async function main() {
  const config = parseArgs(process.argv.slice(2));

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
  let vertexInFlight = false;
  let vertexOverlap = Buffer.alloc(0);

  const recentTranslationLimit = 20;
  const recentTranslations = new Set<string>();
  const recentTranslationQueue: string[] = [];
  const maxSentencesPerFlush = 1;
  const contextWindowSize = 10;
  const contextBuffer: string[] = [];
  const userContext = loadUserContext(config);
  const transcriptBlocks = new Map<number, TranscriptBlock>();
  let nextBlockId = 1;
  let transcriptBuffer = "";
  let lastCommittedText = "";
  let flushTimer: NodeJS.Timeout | null = null;
  let commitTimer: NodeJS.Timeout | null = null;
  let lastFlushAt = Date.now();
  let lastVertexTranscript = "";

  function handlePartialTranscript(_text: string) {
    // Hidden to reduce spam
  }

  function normalizeVertexResponse(raw: string): {
    sourceLanguage?: "ko" | "en";
    transcript?: string;
    translation?: string;
  } | null {
    if (!raw) return null;
    let cleaned = raw.trim();
    cleaned = cleaned
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    try {
      const parsed = JSON.parse(cleaned) as {
        sourceLanguage?: string;
        transcript?: string;
        translation?: string;
      };
      if (!parsed.translation && !parsed.transcript) return null;
      const sourceLanguage =
        parsed.sourceLanguage === "ko" || parsed.sourceLanguage === "en"
          ? parsed.sourceLanguage
          : undefined;
      return {
        sourceLanguage,
        transcript: parsed.transcript?.trim(),
        translation: parsed.translation?.trim(),
      };
    } catch {
      return null;
    }
  }

  function pcmToWavBuffer(pcm: Buffer, sampleRate: number) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcm.length;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);
    pcm.copy(buffer, 44);
    return buffer;
  }

  function normalizeText(text: string) {
    return text.trim().replace(/\s+/g, " ");
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

  function cleanTranslationOutput(text: string) {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return "";
    const filtered = lines.filter(
      (line) =>
        !/^#/.test(line) &&
        !/^translation\b/i.test(line) &&
        !/^explanation\b/i.test(line) &&
        !/^breakdown\b/i.test(line)
    );
    const candidate = (filtered[0] ?? lines[0]).trim();
    return candidate.replace(/^[-–—]\s+/, "");
  }

  function renderBlocks() {
    clearScreen();
    const activeModelId =
      config.engine === "vertex" ? config.vertexModelId : config.modelId;
    const engineLabel = config.engine === "vertex" ? "Vertex" : "ElevenLabs";
    printHeader(
      device.name,
      `${activeModelId} (${engineLabel})`,
      config.intervalMs
    );
    if (userContext) {
      printStatus("Loaded context.md\n");
    }
    const blocks = [...transcriptBlocks.values()].sort((a, b) => a.id - b.id);
    for (const block of blocks) {
      printBlock(block, config.compact);
    }
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
    try {
      const prompt = buildPrompt(text, direction, context);
      const result = await generateText({
        model: bedrockModel,
        system: userContext || undefined,
        prompt,
        temperature: 0,
        maxOutputTokens: 100,
      });

      const translated = cleanTranslationOutput(result.text);
      if (translated) {
        const block = transcriptBlocks.get(blockId);
        if (!block) return;
        block.translation = translated;
        renderBlocks();
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
    };
    transcriptBlocks.set(nextBlockId, block);
    nextBlockId += 1;
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
    renderBlocks();
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
        } else if (msg.message_type === "partial_transcript") {
          handlePartialTranscript(msg.text ?? "");
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

  async function processVertexQueue() {
    if (vertexInFlight || vertexChunkQueue.length === 0) return;
    const chunk = vertexChunkQueue.shift();
    if (!chunk) return;
    vertexInFlight = true;

    try {
      const prompt = buildAudioPrompt(
        config.direction,
        contextBuffer.slice(-contextWindowSize)
      );
      const wavBuffer = pcmToWavBuffer(chunk, 16000);
      const result = await generateText({
        model: vertexModel(config.vertexModelId),
        system: userContext || undefined,
        temperature: 0,
        maxOutputTokens: 512,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "file", mediaType: "audio/wav", data: wavBuffer },
            ],
          },
        ],
      });

      const parsed = normalizeVertexResponse(result.text);
      if (!parsed) {
        createBlock(
          "EN",
          "(Vertex response parse failed)",
          "KR",
          result.text.trim()
        );
        renderBlocks();
        return;
      }
      const transcript = parsed.transcript?.trim() ?? "";
      const translation = parsed.translation?.trim() ?? "";
      const sourceLanguage = parsed.sourceLanguage;
      if (!translation && !transcript) {
        createBlock(
          "EN",
          "(Vertex returned empty response)",
          "KR",
          result.text.trim()
        );
        renderBlocks();
        return;
      }

      const sourceLabel =
        sourceLanguage === "ko" ? "KR" : sourceLanguage === "en" ? "EN" : "EN";
      const targetLabel = sourceLabel === "KR" ? "EN" : "KR";
      const sourceText = transcript || "(unavailable)";

      const block = createBlock(
        sourceLabel,
        sourceText,
        targetLabel,
        translation || undefined
      );
      if (sourceText && hasTranslatableContent(sourceText)) {
        recordContext(sourceText);
      } else if (translation && hasTranslatableContent(translation)) {
        recordContext(translation);
      }
      lastVertexTranscript = transcript;
      renderBlocks();
    } catch (error) {
      createBlock("EN", "(Vertex error)", "KR", toReadableError(error));
      renderBlocks();
    } finally {
      vertexInFlight = false;
      if (vertexChunkQueue.length) {
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
      renderBlocks();
      printStatus(
        "\n⚠️  No audio - check System Settings > Sound > Output: Multi-Output (BlackHole + Speakers)\n"
      );
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

    renderBlocks();
    printStatus("Connecting...");

    if (shouldStreamToScribe()) {
      try {
        ws = await connectScribe();
        printStatus("Streaming. Speak now.\n");
        if (config.engine === "vertex") {
          const projectLabel = config.vertexProject
            ? ` (${config.vertexProject})`
            : "";
          const locationLabel = config.vertexLocation
            ? `@${config.vertexLocation}`
            : "";
          printStatus(
            `Vertex batching every ${(config.intervalMs / 1000).toFixed(
              1
            )}s using ${config.vertexModelId}${locationLabel}${projectLabel}\n`
          );
        }
      } catch (error) {
        isRecording = false;
        console.error(`Connection error: ${toReadableError(error)}`);
        return;
      }
    } else {
      printStatus("Streaming. Speak now.\n");
    }

    try {
      ffmpegProcess = spawnFfmpeg(device.index);
    } catch (error) {
      isRecording = false;
      console.error(`ffmpeg error: ${toReadableError(error)}`);
      return;
    }

    if (!ffmpegProcess.stdout) {
      isRecording = false;
      console.error("ffmpeg failed");
      return;
    }

    attachAudioStream(ffmpegProcess.stdout);
    startNoAudioTimer();
    startFlushTimer();
    startCommitTimer();
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
    vertexInFlight = false;

    renderBlocks();
    printStatus("\nPaused. SPACE to resume, Q to quit.\n");
  }

  function shutdown() {
    if (isRecording) stopRecording();
    exitFullscreen();
    process.exit(0);
  }

  // Keyboard
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  process.stdin.on("keypress", (_str, key) => {
    if ((key.ctrl && key.name === "c") || key.name === "q") shutdown();
    if (key.name === "space") {
      if (isRecording) stopRecording();
      else void startRecording();
    }
  });

  process.on("SIGINT", shutdown);

  enterFullscreen();
  renderBlocks();

  await startRecording();
}

function parseArgs(argv: string[]): CliConfig {
  const config: CliConfig = {
    device: undefined,
    direction: "auto",
    intervalMs: DEFAULT_INTERVAL_MS,
    modelId: DEFAULT_MODEL_ID,
    engine: "elevenlabs",
    vertexModelId: DEFAULT_VERTEX_MODEL_ID,
    vertexProject: process.env.GOOGLE_VERTEX_PROJECT_ID,
    vertexLocation: DEFAULT_VERTEX_LOCATION,
    listDevices: false,
    help: false,
    contextFile: path.resolve("context.md"),
    useContext: true,
    compact: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      config.help = true;
      continue;
    }
    if (arg === "--list-devices") {
      config.listDevices = true;
      continue;
    }

    if (arg.startsWith("--device")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.device = val;
      continue;
    }
    if (arg.startsWith("--direction")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val === "auto" || val === "ko-en" || val === "en-ko")
        config.direction = val;
      continue;
    }
    if (arg.startsWith("--model")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.modelId = val;
      continue;
    }
    if (arg.startsWith("--engine")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val === "elevenlabs" || val === "vertex") config.engine = val;
      continue;
    }
    if (arg.startsWith("--vertex-model")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.vertexModelId = val;
      continue;
    }
    if (arg.startsWith("--vertex-project")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.vertexProject = val;
      continue;
    }
    if (arg.startsWith("--vertex-location")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.vertexLocation = val;
      continue;
    }
    if (arg.startsWith("--context-file")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.contextFile = val;
      continue;
    }
    if (arg === "--no-context") {
      config.useContext = false;
      continue;
    }
    if (arg === "--compact") {
      config.compact = true;
      continue;
    }
  }
  return config;
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

function toReadableError(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

main().catch((e) => {
  exitFullscreen();
  console.error(`Fatal: ${toReadableError(e)}`);
  process.exit(1);
});
