// All shared types for the translator app.
// Both terminal and Electron UIs import from here.

export type LanguageCode =
  | "en" | "es" | "fr" | "de" | "it" | "pt"
  | "zh" | "ja" | "ko" | "ar" | "hi" | "ru" | "tl";

export type Language = {
  code: LanguageCode;
  name: string;
  native: string;
};

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Espa\u00f1ol" },
  { code: "fr", name: "French", native: "Fran\u00e7ais" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "pt", name: "Portuguese", native: "Portugu\u00eas" },
  { code: "zh", name: "Chinese", native: "\u4e2d\u6587" },
  { code: "ja", name: "Japanese", native: "\u65e5\u672c\u8a9e" },
  { code: "ko", name: "Korean", native: "\ud55c\uad6d\uc5b4" },
  { code: "ar", name: "Arabic", native: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629" },
  { code: "hi", name: "Hindi", native: "\u0939\u093f\u0928\u094d\u0926\u0940" },
  { code: "ru", name: "Russian", native: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439" },
  { code: "tl", name: "Tagalog", native: "Tagalog" },
];

export type Direction = "auto" | "source-target";
export type Device = { index: number; name: string };

export type TranscriptBlock = {
  id: number;
  sourceLabel: string;
  sourceText: string;
  targetLabel: string;
  translation?: string;
  partial?: boolean;
  newTopic?: boolean;
  createdAt: number;
};

export type Summary = {
  keyPoints: string[];
  updatedAt: number;
};

export type UIState = {
  deviceName: string;
  modelId: string;
  intervalMs: number;
  status: "idle" | "connecting" | "recording" | "paused";
  contextLoaded: boolean;
  cost?: number;
};

export type IntroSelection = {
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
};

export type SessionConfig = {
  device?: string;
  direction: Direction;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  intervalMs: number;
  vertexModelId: string;
  vertexProject?: string;
  vertexLocation: string;
  contextFile: string;
  useContext: boolean;
  compact: boolean;
  debug: boolean;
  legacyAudio: boolean;
};

export type CliConfig = SessionConfig & {
  listDevices: boolean;
  help: boolean;
  skipIntro: boolean;
};

export const DEFAULT_VERTEX_MODEL_ID =
  process.env.VERTEX_MODEL_ID ?? "gemini-3-flash-preview";
export const DEFAULT_VERTEX_LOCATION =
  process.env.GOOGLE_VERTEX_PROJECT_LOCATION ?? "global";
export const DEFAULT_INTERVAL_MS = 2000;

// Session event types for EventEmitter
export type SessionEvents = {
  "state-change": [state: UIState];
  "block-added": [block: TranscriptBlock];
  "block-updated": [block: TranscriptBlock];
  "blocks-cleared": [];
  "summary-updated": [summary: Summary | null];
  "cost-updated": [cost: number];
  "status": [text: string];
  "error": [error: string];
};
