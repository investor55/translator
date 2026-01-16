import "dotenv/config";
import WebSocket from "ws";
import { generateText } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";

import type {
  CliConfig,
  Device,
  FixedDirection,
  TranscriptEntry,
  TranslationJob,
} from "./types";
import { DEFAULT_MODEL_ID, DEFAULT_INTERVAL_MS } from "./types";
import {
  listAvfoundationDevices,
  selectAudioDevice,
  formatDevices,
  spawnFfmpeg,
} from "./audio";
import {
  createUi,
  enableTranscriptScrolling,
  formatLine,
  formatPartialLine,
} from "./ui";
import {
  buildPrompt,
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

  validateEnv();

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

  const { screen, transcriptBox, statusBar } = createUi();
  const bedrockModel = bedrock(config.modelId);

  let isRecording = false;
  let statusNote = "Idle";
  let transcriptPartial = "";
  let transcriptEntries: TranscriptEntry[] = [];
  let lastPartialSource = "";
  let followTranscript = true;
  let nextEntryId = 1;
  let lastEntryId: number | null = null;
  let lastEntryDirection: FixedDirection | null = null;
  let lastEntryAt = 0;

  enableTranscriptScrolling(transcriptBox, isAtBottom, (value) => {
    followTranscript = value;
  });

  let ws: WebSocket | null = null;
  let ffmpegProcess: ReturnType<typeof spawnFfmpeg> | null = null;
  let audioBuffer = Buffer.alloc(0);
  let partialTimer: NodeJS.Timeout | null = null;
  let recordingStartedAt: number | null = null;
  let audioBytesSent = 0;
  let noAudioTimer: NodeJS.Timeout | null = null;
  let audioWarningShown = false;
  let audioDataSeen = false;
  let firstChunkSent = false;

  const finalQueue: TranslationJob[] = [];
  let pendingPartial: TranslationJob | null = null;
  let translationInFlight = false;

  function isAtBottom() {
    const scrollPerc = transcriptBox.getScrollPerc();
    return scrollPerc < 0 || scrollPerc >= 99.5;
  }

  function findEntryById(entryId?: number) {
    if (!entryId) return undefined;
    return transcriptEntries.find((entry) => entry.id === entryId);
  }

  function addTranscriptEntry(entry: TranscriptEntry) {
    transcriptEntries.push(entry);
    if (transcriptEntries.length > 2000) {
      transcriptEntries = transcriptEntries.slice(-2000);
    }
  }

  function countSentences(text: string) {
    return (text.match(/[.!?。！？]/g) ?? []).length;
  }

  function shouldAppendToLastEntry(
    direction: FixedDirection,
    timestamp: number
  ) {
    if (!lastEntryId || !lastEntryDirection) return false;
    if (lastEntryDirection !== direction) return false;
    if (timestamp - lastEntryAt >= 8000) return false;
    const entry = findEntryById(lastEntryId);
    if (!entry) return false;
    const text = direction === "ko-en" ? entry.korean : entry.english;
    if (!text) return false;
    return countSentences(text) < 2;
  }

  function renderTranscriptEntries() {
    const lines: string[] = [];
    for (const entry of transcriptEntries) {
      if (entry.source === "ko") {
        if (entry.korean) lines.push(formatLine("KR", entry.korean));
        if (entry.english) lines.push(formatLine("EN", entry.english));
      } else {
        if (entry.english) lines.push(formatLine("EN", entry.english));
        if (entry.korean) lines.push(formatLine("KR", entry.korean));
      }
    }
    return lines;
  }

  function updateTranscriptBox() {
    const lines = renderTranscriptEntries().slice(-600);
    if (transcriptPartial) {
      lines.push(formatPartialLine(transcriptPartial));
    }
    transcriptBox.setContent(lines.join("\n") || " ");
    if (followTranscript) {
      transcriptBox.setScrollPerc(100);
    }
    screen.render();
  }

  function translatePartialNow(text: string) {
    const trimmed = text.trim();
    if (!trimmed || translationInFlight) return;
    const entryId = lastEntryId;
    if (!entryId) return;
    const entry = findEntryById(entryId);
    if (!entry) return;
    if (entry.source === "ko" && entry.english) return;
    if (entry.source === "en" && entry.korean) return;
    const direction = entry.source === "ko" ? "ko-en" : "en-ko";
    pendingPartial = {
      kind: "partial",
      text: trimmed,
      direction,
      entryId,
    };
    void processTranslationQueue();
  }

  function updateStatusBar() {
    const directionLabel =
      config.direction === "auto" ? "auto" : config.direction;
    const content = `${isRecording ? "REC" : "PAUSED"} | ${statusNote} | ${device.name} | ${directionLabel}`;
    statusBar.setContent(content);
    screen.render();
  }

  function setStatus(note: string) {
    statusNote = note;
    updateStatusBar();
  }

  async function translateText(text: string, direction: FixedDirection) {
    const prompt = buildPrompt(text, direction);
    const result = await generateText({
      model: bedrockModel,
      prompt,
      temperature: 0,
      maxTokens: 80,
    });
    return result.text.trim();
  }

  function enqueueFinalTranslation(text: string, entryId: number) {
    const trimmed = text.trim();
    if (!hasTranslatableContent(trimmed)) return;
    finalQueue.push({
      kind: "final",
      text: trimmed,
      direction: resolveDirection(trimmed, config.direction),
      entryId,
    });
    void processTranslationQueue();
  }

  function shouldTranslateFinal(job: TranslationJob) {
    const entry = findEntryById(job.entryId);
    if (!entry) return true;
    if (job.direction === "ko-en") return !entry.english;
    return !entry.korean;
  }

  async function processTranslationQueue() {
    if (translationInFlight) return;
    translationInFlight = true;

    while (finalQueue.length > 0 || pendingPartial) {
      const job = finalQueue.length > 0 ? finalQueue.shift() : pendingPartial;
      if (!job) break;
      if (job.kind === "partial") {
        pendingPartial = null;
      } else if (!shouldTranslateFinal(job)) {
        continue;
      }

      try {
        setStatus("Translating");
        const translated = await translateText(job.text, job.direction);
        if (translated) {
          const entry = findEntryById(job.entryId);
          if (entry) {
            const isSameText =
              (job.direction === "ko-en" && entry.english === translated) ||
              (job.direction === "en-ko" && entry.korean === translated);
            if (!isSameText) {
              if (job.direction === "ko-en") {
                entry.english = translated;
              } else {
                entry.korean = translated;
              }
              updateTranscriptBox();
            }
          }
        }
      } catch (error) {
        setStatus(`Translation error: ${toReadableError(error)}`);
      }
    }

    translationInFlight = false;
    setStatus(isRecording ? "Streaming" : "Paused");
  }

  function handlePartialTranscript(text: string) {
    if (!text) return;
    transcriptPartial = text;
    updateTranscriptBox();
    translatePartialNow(text);
  }

  function handleCommittedTranscript(text: string) {
    if (!text) return;

    const now = Date.now();
    const direction = resolveDirection(text, config.direction);
    const shouldAppend = shouldAppendToLastEntry(direction, now);
    const entryId = shouldAppend ? lastEntryId! : nextEntryId++;
    const entry = findEntryById(entryId);

    if (entry) {
      if (direction === "ko-en") {
        entry.korean = entry.korean ? `${entry.korean} ${text}` : text;
      } else {
        entry.english = entry.english ? `${entry.english} ${text}` : text;
      }
    } else {
      addTranscriptEntry({
        id: entryId,
        korean: direction === "ko-en" ? text : undefined,
        english: direction === "en-ko" ? text : undefined,
        source: direction === "ko-en" ? "ko" : "en",
      });
    }

    lastEntryId = entryId;
    lastEntryDirection = direction;
    lastEntryAt = now;

    transcriptPartial = "";
    lastPartialSource = "";
    updateTranscriptBox();

    // Translate immediately without waiting for sentence extraction
    enqueueFinalTranslation(text, entryId);
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
        setStatus("Scribe timeout: no session_started");
        socket.close();
        reject(new Error("Scribe timeout: no session_started"));
      }, 7000);

      const clearSessionTimeout = () => clearTimeout(sessionTimeout);

      socket.on("open", () => setStatus("WebSocket open"));

      socket.on("message", (raw) => {
        let message: {
          message_type?: string;
          text?: string;
          error?: string;
          message?: string;
          detail?: string;
        };
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (message.message_type === "session_started" && !ready) {
          ready = true;
          clearSessionTimeout();
          setStatus("Session started");
          resolve(socket);
          return;
        }

        if (message.message_type === "partial_transcript") {
          handlePartialTranscript(message.text ?? "");
        } else if (
          message.message_type === "committed_transcript" ||
          message.message_type === "committed_transcript_with_timestamps"
        ) {
          handleCommittedTranscript(message.text ?? "");
        } else if (message.message_type === "input_error") {
          const detail =
            message.error ?? message.message ?? message.detail ?? "unknown";
          setStatus(`Input error: ${detail}`);
        } else if (message.message_type === "error") {
          const detail =
            message.error ?? message.message ?? message.detail ?? "unknown";
          setStatus(`Scribe error: ${detail}`);
        }
      });

      socket.on("unexpected-response", (_req, res) => {
        clearSessionTimeout();
        const status = res.statusCode ?? "unknown";
        const reason = res.statusMessage ?? "";
        setStatus(`WebSocket rejected: ${status} ${reason}`.trim());
      });

      socket.on("error", (error) => {
        clearSessionTimeout();
        if (!ready) {
          reject(error);
          return;
        }
        setStatus(`WebSocket error: ${toReadableError(error)}`);
      });

      socket.on("close", (code, reason) => {
        clearSessionTimeout();
        if (isRecording) {
          const detail = reason?.toString() ?? "";
          const label = detail
            ? `WebSocket closed: ${code} ${detail}`
            : `WebSocket closed: ${code}`;
          const noAudioNote =
            audioBytesSent === 0
              ? " (no audio sent - set Output -> Multi-Output: BlackHole + Speakers)"
              : "";
          setStatus(`${label}${noAudioNote}`);
        }
      });
    });
  }

  function sendAudioChunk(chunk: Buffer) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    audioBytesSent += chunk.length;
    if (!firstChunkSent) firstChunkSent = true;
    if (audioWarningShown) {
      audioWarningShown = false;
      setStatus("Streaming");
    }
    ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: chunk.toString("base64"),
        commit: false,
        sample_rate: 16000,
      })
    );
  }

  function attachAudioStream(stream: NodeJS.ReadableStream) {
    const chunkSize = 3200;
    audioBuffer = Buffer.alloc(0);
    stream.on("data", (data: Buffer) => {
      if (!audioDataSeen) audioDataSeen = true;
      audioBuffer = Buffer.concat(
        [audioBuffer, data],
        audioBuffer.length + data.length
      );
      while (audioBuffer.length >= chunkSize) {
        const chunk = audioBuffer.subarray(0, chunkSize);
        audioBuffer = audioBuffer.subarray(chunkSize);
        sendAudioChunk(chunk);
      }
    });
  }

  function startPartialTimer() {
    if (partialTimer) clearInterval(partialTimer);
    partialTimer = setInterval(() => {
      if (!isRecording) return;
      const text = transcriptPartial.trim();
      if (!text || text === lastPartialSource) return;
      lastPartialSource = text;
      translatePartialNow(text);
    }, config.intervalMs);
  }

  function stopPartialTimer() {
    if (partialTimer) {
      clearInterval(partialTimer);
      partialTimer = null;
    }
  }

  function startNoAudioTimer() {
    if (noAudioTimer) clearInterval(noAudioTimer);
    noAudioTimer = setInterval(() => {
      if (!isRecording || audioWarningShown) return;
      if (audioBytesSent > 0) return;
      if (!recordingStartedAt) return;
      if (Date.now() - recordingStartedAt < 3000) return;
      audioWarningShown = true;
      setStatus(
        "No audio detected (Output -> Multi-Output: BlackHole + Speakers)"
      );
    }, 1000);
  }

  function stopNoAudioTimer() {
    if (noAudioTimer) {
      clearInterval(noAudioTimer);
      noAudioTimer = null;
    }
  }

  async function startRecording() {
    if (isRecording) return;
    isRecording = true;
    recordingStartedAt = Date.now();
    audioBytesSent = 0;
    audioWarningShown = false;
    audioDataSeen = false;
    firstChunkSent = false;
    setStatus("Connecting");
    updateStatusBar();

    try {
      ws = await connectScribe();
    } catch (error) {
      isRecording = false;
      setStatus(`Connection error: ${toReadableError(error)}`);
      return;
    }

    try {
      ffmpegProcess = spawnFfmpeg(device.index);
    } catch (error) {
      isRecording = false;
      setStatus(`ffmpeg error: ${toReadableError(error)}`);
      return;
    }

    if (!ffmpegProcess.stdout) {
      isRecording = false;
      setStatus("ffmpeg failed to start");
      return;
    }

    ffmpegProcess.stderr?.on("data", (data) => {
      const text = data.toString().trim();
      if (text) setStatus(`ffmpeg: ${text}`);
    });

    ffmpegProcess.on("close", () => {
      if (isRecording) setStatus("Audio capture stopped");
    });

    attachAudioStream(ffmpegProcess.stdout);
    startPartialTimer();
    startNoAudioTimer();
    setStatus("Streaming");
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    stopPartialTimer();
    stopNoAudioTimer();
    recordingStartedAt = null;
    audioBytesSent = 0;
    audioWarningShown = false;

    if (ffmpegProcess) {
      ffmpegProcess.kill("SIGTERM");
      ffmpegProcess = null;
    }

    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            message_type: "input_audio_chunk",
            audio_base_64: "",
            commit: true,
            sample_rate: 16000,
          })
        );
      }
      ws.close();
      ws = null;
    }

    transcriptPartial = "";
    updateTranscriptBox();
    setStatus("Paused");
  }

  async function toggleRecording() {
    if (isRecording) {
      stopRecording();
      return;
    }
    await startRecording();
  }

  function shutdown() {
    stopRecording();
    screen.destroy();
    process.exit(0);
  }

  screen.key(["C-c", "q"], () => shutdown());
  screen.key(["space"], () => void toggleRecording());
  process.on("SIGINT", () => shutdown());

  updateTranscriptBox();
  updateStatusBar();

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

  for (let i = 0; i < argv.length; i += 1) {
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
      const { value, nextIndex } = readFlagValue(arg, argv, i);
      if (!value) throw new Error("Missing value for --device");
      config.device = value;
      i = nextIndex;
      continue;
    }

    if (arg.startsWith("--direction")) {
      const { value, nextIndex } = readFlagValue(arg, argv, i);
      if (!value) throw new Error("Missing value for --direction");
      if (value !== "auto" && value !== "ko-en" && value !== "en-ko") {
        throw new Error("Invalid --direction value");
      }
      config.direction = value;
      i = nextIndex;
      continue;
    }

    if (arg.startsWith("--interval")) {
      const { value, nextIndex } = readFlagValue(arg, argv, i);
      if (!value || Number.isNaN(Number(value))) {
        throw new Error("Invalid --interval value");
      }
      config.intervalMs = Number(value);
      i = nextIndex;
      continue;
    }

    if (arg.startsWith("--model")) {
      const { value, nextIndex } = readFlagValue(arg, argv, i);
      if (!value) throw new Error("Missing value for --model");
      config.modelId = value;
      i = nextIndex;
      continue;
    }
  }

  return config;
}

function readFlagValue(
  arg: string,
  argv: string[],
  index: number
): { value?: string; nextIndex: number } {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex !== -1) {
    return { value: arg.slice(equalsIndex + 1), nextIndex: index };
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

function printHelp() {
  const helpText = `Usage: bun run src/index.ts [options]

Options:
  --device <name|index>   Audio input device (auto-detects BlackHole)
  --direction auto|ko-en|en-ko
  --interval <ms>         Partial translation interval (default ${DEFAULT_INTERVAL_MS})
  --model <bedrock-id>    Bedrock model id (default ${DEFAULT_MODEL_ID})
  --list-devices          List avfoundation audio devices
  -h, --help              Show help

Environment (loaded from .env if present):
  ELEVENLABS_API_KEY
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_REGION (or AWS_DEFAULT_REGION)
  BEDROCK_MODEL_ID (optional)

Example:
  bun run src/index.ts --device "BlackHole 2ch" --direction auto
`;
  console.log(helpText);
}

function validateEnv() {
  const missing: string[] = [];
  if (!process.env.ELEVENLABS_API_KEY) missing.push("ELEVENLABS_API_KEY");
  if (!process.env.AWS_ACCESS_KEY_ID) missing.push("AWS_ACCESS_KEY_ID");
  if (!process.env.AWS_SECRET_ACCESS_KEY) missing.push("AWS_SECRET_ACCESS_KEY");
  if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
    missing.push("AWS_REGION");
  }
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function toReadableError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${toReadableError(error)}`);
  process.exit(1);
});
