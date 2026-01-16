import "dotenv/config";
import WebSocket from "ws";
import { generateText } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import readline from "readline";

import type { CliConfig, Device, FixedDirection } from "./types";
import { DEFAULT_MODEL_ID, DEFAULT_INTERVAL_MS } from "./types";
import {
  listAvfoundationDevices,
  selectAudioDevice,
  formatDevices,
  spawnFfmpeg,
} from "./audio";
import { printBanner, printLine, printPartial, printStatus, clearPartial } from "./ui";
import {
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
      console.error(`Unable to list devices. Is ffmpeg installed? ${toReadableError(error)}`);
    }
    return;
  }

  validateEnv();

  let devices: Device[] = [];
  try {
    devices = await listAvfoundationDevices();
  } catch (error) {
    console.error(`Unable to list devices. Is ffmpeg installed? ${toReadableError(error)}`);
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

  let isRecording = false;
  let ws: WebSocket | null = null;
  let ffmpegProcess: ReturnType<typeof spawnFfmpeg> | null = null;
  let audioBuffer = Buffer.alloc(0);
  let recordingStartedAt: number | null = null;
  let audioBytesSent = 0;
  let noAudioTimer: NodeJS.Timeout | null = null;
  let audioWarningShown = false;

  const recentTranslationLimit = 20;
  const recentTranslations = new Set<string>();
  const recentTranslationQueue: string[] = [];
  const maxSentencesPerFlush = 2;
  const contextWindowSize = 10;
  const contextBuffer: string[] = [];
  let transcriptBuffer = "";
  let lastCommittedText = "";
  let flushTimer: NodeJS.Timeout | null = null;
  let commitTimer: NodeJS.Timeout | null = null;
  let lastFlushAt = Date.now();

  function handlePartialTranscript(_text: string) {
    // Hidden to reduce spam
  }

  function normalizeText(text: string) {
    return text.trim().replace(/\s+/g, " ");
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

  async function translateAndPrint(
    text: string,
    direction: FixedDirection,
    context: string[]
  ) {
    try {
      const prompt = buildPrompt(text, direction, context);
      const result = await generateText({
        model: bedrockModel,
        prompt,
        temperature: 0,
        maxTokens: 100,
      });

      const translated = cleanTranslationOutput(result.text);
      if (translated) {
        const label = direction === "ko-en" ? "EN" : "KR";
        printLine(label, translated);
      }
    } catch (error) {
      // Silent fail
    }
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

    clearPartial();

    const direction = resolveDirection(sentence, config.direction);
    const sourceLabel = direction === "ko-en" ? "KR" : "EN";
    const context = contextBuffer.slice(-contextWindowSize);

    printLine(sourceLabel, sentence);
    recordContext(sentence);
    void translateAndPrint(sentence, direction, context);
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
      clearPartial();
      const toFlush = sentences.slice(0, maxSentencesPerFlush);
      for (const sentence of toFlush) {
        flushSentence(sentence);
      }
      const leftover = sentences.slice(maxSentencesPerFlush);
      transcriptBuffer = [...leftover, remainder].filter(Boolean).join(" ").trim();
    } else {
      transcriptBuffer = remainder;
    }
  }

  async function connectScribe() {
    const url = "wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime";
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
        } else if (msg.message_type === "committed_transcript" || msg.message_type === "committed_transcript_with_timestamps") {
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
    ws.send(JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: chunk.toString("base64"),
      commit: false,
      sample_rate: 16000,
    }));
  }

  function attachAudioStream(stream: NodeJS.ReadableStream) {
    const chunkSize = 3200;
    stream.on("data", (data: Buffer) => {
      audioBuffer = Buffer.concat([audioBuffer, data]);
      while (audioBuffer.length >= chunkSize) {
        sendAudioChunk(audioBuffer.subarray(0, chunkSize));
        audioBuffer = audioBuffer.subarray(chunkSize);
      }
    });
  }

  function startNoAudioTimer() {
    noAudioTimer = setInterval(() => {
      if (!isRecording || audioWarningShown || audioBytesSent > 0) return;
      if (!recordingStartedAt || Date.now() - recordingStartedAt < 3000) return;
      audioWarningShown = true;
      clearPartial();
      printStatus("\n⚠️  No audio - check System Settings > Sound > Output: Multi-Output (BlackHole + Speakers)\n");
    }, 1000);
  }

  function startFlushTimer() {
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = setInterval(() => {
      if (!isRecording) return;
      const now = Date.now();
      if (now - lastFlushAt < config.intervalMs) return;
      lastFlushAt = now;
      flushTranscriptBuffer();
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
    lastFlushAt = Date.now();

    printStatus("Connecting...");

    try {
      ws = await connectScribe();
      printStatus("Streaming. Speak now.\n");
    } catch (error) {
      isRecording = false;
      console.error(`Connection error: ${toReadableError(error)}`);
      return;
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
    flushTranscriptBuffer();

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

    clearPartial();
    printStatus("\nPaused. SPACE to resume, Q to quit.\n");
  }

  function shutdown() {
    if (isRecording) stopRecording();
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

  printBanner(device.name);

  await startRecording();
}

function parseArgs(argv: string[]): CliConfig {
  const config: CliConfig = {
    device: undefined,
    direction: "auto",
    intervalMs: DEFAULT_INTERVAL_MS,
    modelId: DEFAULT_MODEL_ID,
    listDevices: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { config.help = true; continue; }
    if (arg === "--list-devices") { config.listDevices = true; continue; }

    if (arg.startsWith("--device")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.device = val;
      continue;
    }
    if (arg.startsWith("--direction")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val === "auto" || val === "ko-en" || val === "en-ko") config.direction = val;
      continue;
    }
    if (arg.startsWith("--model")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.modelId = val;
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
  --list-devices             List audio devices
  -h, --help

Controls: SPACE start/pause, Q quit

Env: ELEVENLABS_API_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
`);
}

function validateEnv() {
  const missing = [
    !process.env.ELEVENLABS_API_KEY && "ELEVENLABS_API_KEY",
    !process.env.AWS_ACCESS_KEY_ID && "AWS_ACCESS_KEY_ID",
    !process.env.AWS_SECRET_ACCESS_KEY && "AWS_SECRET_ACCESS_KEY",
    !process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION && "AWS_REGION",
  ].filter(Boolean);

  if (missing.length) {
    console.error(`Missing: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function toReadableError(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

main().catch((e) => {
  console.error(`Fatal: ${toReadableError(e)}`);
  process.exit(1);
});
