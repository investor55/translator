import path from "node:path";
import type { CliConfig, LanguageCode } from "./types";
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

export function validateEnv(config: CliConfig) {
  const missing: string[] = [];

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    missing.push("GOOGLE_APPLICATION_CREDENTIALS");
  }
  if (!process.env.GOOGLE_VERTEX_PROJECT_ID && !config.vertexProject) {
    missing.push("GOOGLE_VERTEX_PROJECT_ID");
  }
  if (!process.env.GOOGLE_VERTEX_PROJECT_LOCATION && !config.vertexLocation) {
    missing.push("GOOGLE_VERTEX_PROJECT_LOCATION");
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

Env: GOOGLE_APPLICATION_CREDENTIALS (Vertex)
     GOOGLE_VERTEX_PROJECT_ID, GOOGLE_VERTEX_PROJECT_LOCATION
`);
}
