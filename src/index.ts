import "dotenv/config";
import blessed from "blessed";
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { generateText } from "ai";
import { bedrock } from "@ai-sdk/amazon-bedrock";

type Direction = "auto" | "ko-en" | "en-ko";
type FixedDirection = Exclude<Direction, "auto">;
type Device = { index: number; name: string };

type CliConfig = {
  device?: string;
  direction: Direction;
  intervalMs: number;
  modelId: string;
  listDevices: boolean;
  help: boolean;
};

type TranslationJob = {
  kind: "final" | "partial";
  text: string;
  direction: FixedDirection;
  context: string[];
};

const DEFAULT_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? "claude-haiku-4-5-20251001";
const DEFAULT_INTERVAL_MS = 2000;
const CONTEXT_WINDOW = 3;

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

  const screen = blessed.screen({
    smartCSR: true,
    title: "Realtime Translator",
  });

  const transcriptBox = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: "100%-1",
    label: "Transcript + Translation",
    border: "line",
    tags: false,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: " ", track: { bg: "gray" }, style: { inverse: true } },
  });

  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    style: { bg: "blue", fg: "white" },
    tags: false,
  });

  screen.append(transcriptBox);
  screen.append(statusBar);

  const bedrockModel = bedrock(config.modelId);

  let isRecording = false;
  let statusNote = "Idle";
  let transcriptPartial = "";
  let committedBuffer = "";
  let conversationLines: string[] = [];
  let translationContext: string[] = [];
  let lastPartialSource = "";

  let ws: WebSocket | null = null;
  let ffmpegProcess: ReturnType<typeof spawn> | null = null;
  let audioBuffer = Buffer.alloc(0);
  let partialTimer: NodeJS.Timeout | null = null;
  let recordingStartedAt: number | null = null;
  let audioBytesSent = 0;
  let noAudioTimer: NodeJS.Timeout | null = null;
  let audioWarningShown = false;
  let audioDataSeen = false;
  let firstChunkSent = false;
  let encodingLogged = false;

  const finalQueue: TranslationJob[] = [];
  let pendingPartial: TranslationJob | null = null;
  let translationInFlight = false;

  function updateTranscriptBox() {
    const lines = conversationLines.slice(-300);
    if (transcriptPartial) {
      lines.push(`… ${transcriptPartial}`);
    }
    transcriptBox.setContent(lines.join("\n") || " ");
    transcriptBox.setScrollPerc(100);
    screen.render();
  }

  function updateStatusBar() {
    const directionLabel =
      config.direction === "auto" ? "auto" : config.direction;
    const content = `${isRecording ? "REC" : "PAUSED"} | ${statusNote} | ${
      device.name
    } | ${directionLabel}`;
    statusBar.setContent(content);
    screen.render();
  }

  function setStatus(note: string) {
    statusNote = note;
    updateStatusBar();
  }

  async function translateText(
    text: string,
    direction: FixedDirection,
    context: string[]
  ) {
    const prompt = buildPrompt(text, direction, context);
    const result = await generateText({
      model: bedrockModel,
      prompt,
    });
    return result.text.trim();
  }

  function enqueueFinalTranslation(text: string, context: string[]) {
    const trimmed = text.trim();
    if (!hasTranslatableContent(trimmed)) {
      return;
    }
    finalQueue.push({
      kind: "final",
      text: trimmed,
      direction: resolveDirection(trimmed, config.direction),
      context,
    });
    void processTranslationQueue();
  }

  function enqueuePartialTranslation(text: string) {
    void text;
  }

  async function processTranslationQueue() {
    if (translationInFlight) {
      return;
    }
    translationInFlight = true;

    while (finalQueue.length > 0 || pendingPartial) {
      const job = finalQueue.length > 0 ? finalQueue.shift() : pendingPartial;
      if (!job) {
        break;
      }
      if (job.kind === "partial") {
        pendingPartial = null;
      }

      try {
        setStatus("Translating");
        const translated = await translateText(
          job.text,
          job.direction,
          job.context
        );
        if (translated) {
          if (job.kind === "partial") {
            // partial translations disabled
          } else {
            conversationLines.push(`EN: ${translated}`);
          }
          updateTranscriptBox();
        }
      } catch (error) {
        setStatus(`Translation error: ${toReadableError(error)}`);
      }
    }

    translationInFlight = false;
    setStatus(isRecording ? "Streaming" : "Paused");
  }

  function handlePartialTranscript(text: string) {
    if (!text) {
      return;
    }
    if (!encodingLogged) {
      encodingLogged = true;
    }
    transcriptPartial = text;
    updateTranscriptBox();
  }

  function handleCommittedTranscript(text: string) {
    if (!text) {
      return;
    }
    conversationLines.push(`KR: ${text}`);
    if (conversationLines.length > 6000) {
      conversationLines = conversationLines.slice(-6000);
    }
    transcriptPartial = "";
    lastPartialSource = "";
    updateTranscriptBox();

    committedBuffer = committedBuffer ? `${committedBuffer} ${text}` : text;
    const { sentences, remainder } = extractSentences(committedBuffer);
    committedBuffer = remainder;
    for (const sentence of sentences) {
      const context = translationContext.slice(-CONTEXT_WINDOW);
      enqueueFinalTranslation(sentence, context);
      translationContext.push(sentence);
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
        if (ready) {
          return;
        }
        setStatus("Scribe timeout: no session_started");
        socket.close();
        reject(new Error("Scribe timeout: no session_started"));
      }, 7000);

      const clearSessionTimeout = () => {
        clearTimeout(sessionTimeout);
      };

      socket.on("open", () => {
        setStatus("WebSocket open");
      });

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
        } else if (message.message_type === "committed_transcript") {
          handleCommittedTranscript(message.text ?? "");
        } else if (
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
              ? " (no audio sent — set Output -> Multi-Output: BlackHole + Speakers)"
              : "";
          setStatus(`${label}${noAudioNote}`);
        }
      });
    });
  }

  function sendAudioChunk(chunk: Buffer) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    audioBytesSent += chunk.length;
    if (!firstChunkSent) {
      firstChunkSent = true;
    }
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
      if (!audioDataSeen) {
        audioDataSeen = true;
      }
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

  function spawnFfmpeg() {
    const args = [
      "-f",
      "avfoundation",
      "-i",
      `:${device.index}`,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "-loglevel",
      "error",
      "-nostdin",
      "-",
    ];
    return spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  function startPartialTimer() {
    if (partialTimer) {
      clearInterval(partialTimer);
    }
    partialTimer = setInterval(() => {
      if (!isRecording) {
        return;
      }
      const text = transcriptPartial.trim();
      if (!text || text === lastPartialSource) {
        return;
      }
      lastPartialSource = text;
      enqueuePartialTranslation(text);
    }, config.intervalMs);
  }

  function stopPartialTimer() {
    if (partialTimer) {
      clearInterval(partialTimer);
      partialTimer = null;
    }
  }

  function startNoAudioTimer() {
    if (noAudioTimer) {
      clearInterval(noAudioTimer);
    }
    noAudioTimer = setInterval(() => {
      if (!isRecording || audioWarningShown) {
        return;
      }
      if (audioBytesSent > 0) {
        return;
      }
      if (!recordingStartedAt) {
        return;
      }
      if (Date.now() - recordingStartedAt < 3000) {
        return;
      }
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
    if (isRecording) {
      return;
    }
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
      ffmpegProcess = spawnFfmpeg();
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
      if (text) {
        setStatus(`ffmpeg: ${text}`);
      }
    });

    ffmpegProcess.on("close", () => {
      if (isRecording) {
        setStatus("Audio capture stopped");
      }
    });

    attachAudioStream(ffmpegProcess.stdout);
    startPartialTimer();
    startNoAudioTimer();
    setStatus("Streaming");
  }

  function stopRecording() {
    if (!isRecording) {
      return;
    }
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
      if (!value) {
        throw new Error("Missing value for --device");
      }
      config.device = value;
      i = nextIndex;
      continue;
    }

    if (arg.startsWith("--direction")) {
      const { value, nextIndex } = readFlagValue(arg, argv, i);
      if (!value) {
        throw new Error("Missing value for --direction");
      }
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
      if (!value) {
        throw new Error("Missing value for --model");
      }
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
  if (!process.env.ELEVENLABS_API_KEY) {
    missing.push("ELEVENLABS_API_KEY");
  }
  if (!process.env.AWS_ACCESS_KEY_ID) {
    missing.push("AWS_ACCESS_KEY_ID");
  }
  if (!process.env.AWS_SECRET_ACCESS_KEY) {
    missing.push("AWS_SECRET_ACCESS_KEY");
  }
  if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
    missing.push("AWS_REGION");
  }
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}

async function listAvfoundationDevices(): Promise<Device[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      ["-f", "avfoundation", "-list_devices", "true", "-i", ""],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      output += data.toString();
    });
    proc.on("error", (error) => {
      reject(error);
    });
    proc.on("close", () => {
      resolve(parseAvfoundationOutput(output));
    });
  });
}

function parseAvfoundationOutput(output: string): Device[] {
  const lines = output.split("\n");
  const devices: Device[] = [];
  let inAudioSection = false;

  for (const line of lines) {
    if (line.includes("AVFoundation audio devices")) {
      inAudioSection = true;
      continue;
    }
    if (line.includes("AVFoundation video devices")) {
      inAudioSection = false;
      continue;
    }
    if (!inAudioSection) {
      continue;
    }

    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (match) {
      devices.push({ index: Number(match[1]), name: match[2].trim() });
    }
  }

  return devices;
}

function selectAudioDevice(devices: Device[], override?: string): Device | null {
  if (override) {
    if (/^\d+$/.test(override)) {
      const index = Number(override);
      return devices.find((device) => device.index === index) ?? null;
    }

    const lowered = override.toLowerCase();
    return (
      devices.find((device) => device.name.toLowerCase().includes(lowered)) ??
      null
    );
  }

  const matchers = [
    "blackhole",
    "loopback",
    "soundflower",
    "vb-cable",
    "ishowu",
  ];

  return (
    devices.find((device) =>
      matchers.some((matcher) =>
        device.name.toLowerCase().includes(matcher)
      )
    ) ?? null
  );
}

function formatDevices(devices: Device[]) {
  if (devices.length === 0) {
    return "No avfoundation audio devices found.";
  }
  return devices.map((device) => `[${device.index}] ${device.name}`).join("\n");
}

function extractSentences(text: string) {
  const sentences: string[] = [];
  let buffer = "";

  for (const ch of text) {
    if (ch === "\n") {
      if (hasTranslatableContent(buffer)) {
        sentences.push(buffer.trim());
      }
      buffer = "";
      continue;
    }

    buffer += ch;

    if (/[.!?。！？]/.test(ch)) {
      if (hasTranslatableContent(buffer)) {
        sentences.push(buffer.trim());
      }
      buffer = "";
    }
  }

  return { sentences, remainder: buffer };
}

function hasTranslatableContent(text: string) {
  return /[A-Za-z0-9가-힣]/.test(text);
}

function resolveDirection(text: string, direction: Direction): FixedDirection {
  if (direction !== "auto") {
    return direction;
  }
  return /[가-힣]/.test(text) ? "ko-en" : "en-ko";
}

function buildPrompt(
  text: string,
  direction: FixedDirection,
  context: string[]
) {
  const source = direction === "ko-en" ? "Korean" : "English";
  const target = direction === "ko-en" ? "English" : "Korean";
  const contextBlock =
    context.length > 0
      ? `Context (previous sentences, do not translate):\n${context.join("\n")}\n\n`
      : "";

  return `Translate ONLY the latest ${source} sentence to ${target}. Use the context for disambiguation, but do NOT translate it. Output only the translation, preserving punctuation and line breaks.

${contextBlock}${text}`;
}

function toReadableError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
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
