import path from "node:path";
import type { CliConfig, LanguageCode, TranscriptionProvider, AnalysisProvider } from "./types";
import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_VERTEX_MODEL_ID,
  DEFAULT_VERTEX_LOCATION,
} from "./types";
import { isValidLangCode } from "./language";

export function parseArgs(argv: string[]): CliConfig {
  const config: CliConfig = {
    device: undefined,
    direction: "auto",
    sourceLang: "ko",
    targetLang: "en",
    intervalMs: DEFAULT_INTERVAL_MS,
    transcriptionProvider: "vertex",
    transcriptionModelId: DEFAULT_VERTEX_MODEL_ID,
    analysisProvider: "vertex",
    analysisModelId: DEFAULT_VERTEX_MODEL_ID,
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
    translationEnabled: true,
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
    if (arg.startsWith("--vertex-model")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) {
        config.transcriptionModelId = val;
        config.analysisModelId = val;
      }
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
    if (arg.startsWith("--transcription-provider")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val === "google" || val === "vertex") config.transcriptionProvider = val;
      continue;
    }
    if (arg.startsWith("--analysis-provider")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val === "openrouter" || val === "google" || val === "vertex") config.analysisProvider = val;
      continue;
    }
    if (arg.startsWith("--transcription-model")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.transcriptionModelId = val;
      continue;
    }
    if (arg.startsWith("--analysis-model")) {
      const val = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (val) config.analysisModelId = val;
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

export function validateEnv(config: Pick<CliConfig, "transcriptionProvider" | "analysisProvider" | "vertexProject" | "vertexLocation">) {
  const missing: string[] = [];

  const needsVertex = config.transcriptionProvider === "vertex" || config.analysisProvider === "vertex";
  const needsGoogle = config.transcriptionProvider === "google" || config.analysisProvider === "google";
  const needsOpenRouter = config.analysisProvider === "openrouter";

  if (needsVertex) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      missing.push("GOOGLE_APPLICATION_CREDENTIALS");
    }
    if (!process.env.GOOGLE_VERTEX_PROJECT_ID && !config.vertexProject) {
      missing.push("GOOGLE_VERTEX_PROJECT_ID");
    }
  }

  if (needsGoogle) {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.GEMINI_API_KEY) {
      missing.push("GOOGLE_GENERATIVE_AI_API_KEY");
    }
  }

  if (needsOpenRouter) {
    if (!process.env.OPENROUTER_API_KEY) {
      missing.push("OPENROUTER_API_KEY");
    }
  }

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

export function printHelp() {
  console.log(`Usage: bun run src/terminal/index.ts [options]

Options:
  --source-lang <code>       Input language code (default: ko)
  --target-lang <code>       Output language code (default: en)
  --skip-intro               Skip language selection screen, use CLI values
  --direction auto|source-target  Detection mode (default: auto)
  --transcription-provider google|vertex  Transcription provider (default: vertex)
  --analysis-provider openrouter|google|vertex  Analysis provider (default: vertex)
  --transcription-model <id> Override transcription model
  --analysis-model <id>      Override analysis model
  --vertex-model <id>        Set both models (Vertex shorthand). Default: ${DEFAULT_VERTEX_MODEL_ID}
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

Env: GOOGLE_APPLICATION_CREDENTIALS (Vertex)
     GOOGLE_VERTEX_PROJECT_ID
     GOOGLE_GENERATIVE_AI_API_KEY (Google AI)
     OPENROUTER_API_KEY (OpenRouter)
`);
}
