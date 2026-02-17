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
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "tl", name: "Tagalog", native: "Tagalog" },
];

export type Direction = "auto" | "source-target";
export type Device = { index: number; name: string };
export type AudioSource = "system" | "microphone";

export type TranscriptBlock = {
  id: number;
  sourceLabel: string;
  sourceText: string;
  targetLabel: string;
  translation?: string;
  partial?: boolean;
  newTopic?: boolean;
  createdAt: number;
  audioSource: AudioSource;
  sessionId?: string;
};

export type Summary = {
  keyPoints: string[];
  updatedAt: number;
};

export type TodoItem = Readonly<{
  id: string;
  text: string;
  completed: boolean;
  source: "ai" | "manual";
  createdAt: number;
  completedAt?: number;
  sessionId?: string;
}>;

export type TodoSuggestion = Readonly<{
  id: string;
  text: string;
  sessionId?: string;
  createdAt: number;
}>;

export type InsightKind = "definition" | "context" | "fact" | "tip" | "key-point";

export type Insight = Readonly<{
  id: string;
  kind: InsightKind;
  text: string;
  createdAt: number;
  sessionId?: string;
}>;

export type SessionMeta = Readonly<{
  id: string;
  startedAt: number;
  endedAt?: number;
  title?: string;
  blockCount: number;
  sourceLang?: LanguageCode;
  targetLang?: LanguageCode;
}>;

export type UIState = {
  deviceName: string;
  modelId: string;
  intervalMs: number;
  status: "idle" | "connecting" | "recording" | "paused";
  contextLoaded: boolean;
  cost?: number;
  translationEnabled: boolean;
  micEnabled: boolean;
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
  translationEnabled: boolean;
  micDevice?: string;
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
  "todo-added": [todo: TodoItem];
  "todo-updated": [todo: TodoItem];
  "todo-suggested": [suggestion: TodoSuggestion];
  "insight-added": [insight: Insight];
  "insights-updated": [insights: Insight[]];
};
