import path from "node:path";
import type { CliConfig } from "./types";
import type { LanguageCode } from "./intro-screen";
import { SUPPORTED_LANGUAGES } from "./intro-screen";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_INTERVAL_MS,
  DEFAULT_VERTEX_MODEL_ID,
  DEFAULT_VERTEX_LOCATION,
} from "./types";

function isValidLangCode(code: string): code is LanguageCode {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

export function pcmToWavBuffer(pcm: Buffer, sampleRate: number): Buffer {
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

export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function cleanTranslationOutput(text: string): string {
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

export function parseArgs(argv: string[]): CliConfig {
  const config: CliConfig = {
    device: undefined,
    direction: "auto",
    sourceLang: "ko",
    targetLang: "en",
    intervalMs: DEFAULT_INTERVAL_MS,
    modelId: DEFAULT_MODEL_ID,
    engine: "vertex",
    vertexModelId: DEFAULT_VERTEX_MODEL_ID,
    vertexProject: process.env.GOOGLE_VERTEX_PROJECT_ID,
    vertexLocation: DEFAULT_VERTEX_LOCATION,
    listDevices: false,
    help: false,
    contextFile: path.resolve("context.md"),
    useContext: true,
    compact: false,
    debug: false,
    skipIntro: false,
    legacyAudio: false,
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
    if (arg === "--skip-intro") {
      config.skipIntro = true;
      continue;
    }

    if (arg.startsWith("--device")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.device = val;
      continue;
    }
    if (arg.startsWith("--direction")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val === "auto" || val === "source-target") config.direction = val;
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
    if (arg === "--debug") {
      config.debug = true;
      continue;
    }
    if (arg === "--legacy-audio") {
      config.legacyAudio = true;
      continue;
    }
    if (arg.startsWith("--source-lang")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val && isValidLangCode(val.toLowerCase())) {
        config.sourceLang = val.toLowerCase() as LanguageCode;
      }
      continue;
    }
    if (arg.startsWith("--target-lang")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val && isValidLangCode(val.toLowerCase())) {
        config.targetLang = val.toLowerCase() as LanguageCode;
      }
      continue;
    }
  }
  return config;
}

export function toReadableError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    // Handle error-like objects (e.g., DOMException, AbortError from SDK)
    if ("message" in e && typeof e.message === "string") return e.message;
    if ("name" in e && typeof e.name === "string") return e.name;
  }
  if (typeof e === "string") return e;
  return "Unknown error";
}
