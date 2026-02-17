// All shared types for the translator app.

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
export type ThemeMode = "system" | "light" | "dark";

export type TranscriptionProvider = "google" | "vertex" | "elevenlabs";
export type AnalysisProvider = "openrouter" | "google" | "vertex";

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

export type SessionConfig = {
  device?: string;
  direction: Direction;
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  intervalMs: number;
  transcriptionProvider: TranscriptionProvider;
  transcriptionModelId: string;
  analysisProvider: AnalysisProvider;
  analysisModelId: string;
  todoModelId: string;
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

export type AppConfig = {
  themeMode: ThemeMode;
  direction: Direction;
  intervalMs: number;
  transcriptionProvider: TranscriptionProvider;
  transcriptionModelId: string;
  analysisProvider: AnalysisProvider;
  analysisModelId: string;
  todoModelId: string;
  vertexProject?: string;
  vertexLocation: string;
  contextFile: string;
  useContext: boolean;
  compact: boolean;
  debug: boolean;
  legacyAudio: boolean;
  translationEnabled: boolean;
};

export type AppConfigOverrides = Partial<AppConfig>;

const ENV = typeof process !== "undefined" ? process.env : undefined;

export const DEFAULT_VERTEX_MODEL_ID =
  ENV?.VERTEX_MODEL_ID ?? "gemini-3-flash-preview";
export const DEFAULT_VERTEX_LOCATION =
  ENV?.GOOGLE_VERTEX_PROJECT_LOCATION ?? "global";
export const DEFAULT_TRANSCRIPTION_MODEL_ID =
  ENV?.TRANSCRIPTION_MODEL_ID ?? "scribe_v2_realtime";
export const DEFAULT_ANALYSIS_MODEL_ID =
  ENV?.ANALYSIS_MODEL_ID ?? "moonshotai/kimi-k2-thinking";
export const DEFAULT_TODO_MODEL_ID =
  ENV?.TODO_MODEL_ID ?? "openai/gpt-oss-120b";
export const DEFAULT_INTERVAL_MS = 2000;
export const DEFAULT_THEME_MODE: ThemeMode = "system";

export const DEFAULT_APP_CONFIG: AppConfig = {
  themeMode: DEFAULT_THEME_MODE,
  direction: "auto",
  intervalMs: DEFAULT_INTERVAL_MS,
  transcriptionProvider: "elevenlabs",
  transcriptionModelId: DEFAULT_TRANSCRIPTION_MODEL_ID,
  analysisProvider: "openrouter",
  analysisModelId: DEFAULT_ANALYSIS_MODEL_ID,
  todoModelId: DEFAULT_TODO_MODEL_ID,
  vertexProject: ENV?.GOOGLE_VERTEX_PROJECT_ID,
  vertexLocation: DEFAULT_VERTEX_LOCATION,
  contextFile: "context.md",
  useContext: false,
  compact: false,
  debug: !!ENV?.DEBUG,
  legacyAudio: false,
  translationEnabled: true,
};

export function normalizeAppConfig(input?: AppConfigOverrides | null): AppConfig {
  const merged: AppConfig = {
    ...DEFAULT_APP_CONFIG,
    ...(input ?? {}),
  };

  const themeMode: ThemeMode =
    merged.themeMode === "dark" || merged.themeMode === "light" || merged.themeMode === "system"
      ? merged.themeMode
      : DEFAULT_APP_CONFIG.themeMode;
  const direction: Direction =
    merged.direction === "source-target" || merged.direction === "auto"
      ? merged.direction
      : DEFAULT_APP_CONFIG.direction;
  const transcriptionProvider: TranscriptionProvider =
    merged.transcriptionProvider === "google" ||
    merged.transcriptionProvider === "vertex" ||
    merged.transcriptionProvider === "elevenlabs"
      ? merged.transcriptionProvider
      : DEFAULT_APP_CONFIG.transcriptionProvider;
  const analysisProvider: AnalysisProvider =
    merged.analysisProvider === "openrouter" ||
    merged.analysisProvider === "google" ||
    merged.analysisProvider === "vertex"
      ? merged.analysisProvider
      : DEFAULT_APP_CONFIG.analysisProvider;
  const intervalMs =
    Number.isFinite(merged.intervalMs) && merged.intervalMs > 0
      ? Math.round(merged.intervalMs)
      : DEFAULT_APP_CONFIG.intervalMs;

  return {
    ...merged,
    themeMode,
    direction,
    transcriptionProvider,
    analysisProvider,
    intervalMs,
    transcriptionModelId: merged.transcriptionModelId?.trim() || DEFAULT_APP_CONFIG.transcriptionModelId,
    analysisModelId: merged.analysisModelId?.trim() || DEFAULT_APP_CONFIG.analysisModelId,
    todoModelId: merged.todoModelId?.trim() || DEFAULT_APP_CONFIG.todoModelId,
    contextFile: merged.contextFile?.trim() || DEFAULT_APP_CONFIG.contextFile,
    vertexLocation: merged.vertexLocation?.trim() || DEFAULT_APP_CONFIG.vertexLocation,
    vertexProject: merged.vertexProject?.trim() || undefined,
    useContext: !!merged.useContext,
    compact: !!merged.compact,
    debug: !!merged.debug,
    legacyAudio: !!merged.legacyAudio,
    translationEnabled: !!merged.translationEnabled,
  };
}

// Agent types
export type AgentStatus = "running" | "completed" | "failed";
export type AgentStepKind = "thinking" | "tool-call" | "tool-result" | "text" | "user";

export type AgentStep = Readonly<{
  id: string;
  kind: AgentStepKind;
  content: string;
  toolName?: string;
  toolInput?: string;
  createdAt: number;
}>;

export type Agent = {
  id: string;
  todoId: string;
  task: string;
  status: AgentStatus;
  steps: AgentStep[];
  result?: string;
  createdAt: number;
  completedAt?: number;
  sessionId?: string;
};

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
  "agent-started": [agent: Agent];
  "agent-step": [agentId: string, step: AgentStep];
  "agent-completed": [agentId: string, result: string];
  "agent-failed": [agentId: string, error: string];
};
