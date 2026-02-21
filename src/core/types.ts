// All shared types for the translator app.
import { getAnalysisModelPreset, DEFAULT_UTILITY_MODEL_ID, DEFAULT_MEMORY_MODEL_ID } from "./models";

export type LanguageCode =
  | "en"
  | "es"
  | "fr"
  | "de"
  | "it"
  | "pt"
  | "zh"
  | "ja"
  | "ko"
  | "ar"
  | "hi"
  | "ru"
  | "tl";

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
export type LightVariant = "warm" | "linen" | "ivory" | "petal" | "aqua";
export type DarkVariant = "charcoal" | "steel" | "pitch-black" | "abyss";

export type TranscriptionProvider =
  | "google"
  | "vertex"
  | "elevenlabs"
  | "whisper";
export type AnalysisProvider = "openrouter" | "google" | "vertex";
export type { AnalysisModelPreset } from "./models";

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

export type FinalSummary = {
  narrative: string; // concise markdown snapshot of the full conversation
  agreements: string[]; // explicit agreements/decisions reached in the meeting
  missedItems: string[]; // important points that were likely missed or underexplored
  unansweredQuestions: string[]; // open questions that remained unresolved
  agreementTodos: string[]; // concrete follow-up todos tied to agreements
  missedItemTodos: string[]; // concrete todos to address missed/underexplored items
  unansweredQuestionTodos: string[]; // concrete todos to answer unresolved questions
  actionItems: string[]; // cross-cutting action items / todos
  generatedAt: number;
};

export type AgentsSummary = {
  overallNarrative: string;
  agentHighlights: Array<{
    agentId: string;
    task: string;
    status: "completed" | "failed";
    keyFinding: string;
  }>;
  coverageGaps: string[];
  nextSteps: string[];
  generatedAt: number;
  totalAgents: number;
  succeededAgents: number;
  failedAgents: number;
  totalDurationSecs: number;
};

export type TaskItem = Readonly<{
  id: string;
  text: string;
  details?: string;
  size: TaskSize;
  completed: boolean;
  source: "ai" | "manual";
  createdAt: number;
  completedAt?: number;
  sessionId?: string;
}>;

export type TaskSize = "small" | "large";

export type TaskSuggestion = Readonly<{
  id: string;
  text: string;
  details?: string;
  transcriptExcerpt?: string;
  sessionId?: string;
  createdAt: number;
}>;

export type InsightKind =
  | "definition"
  | "context"
  | "fact"
  | "tip"
  | "key-point";

export type Insight = Readonly<{
  id: string;
  kind: InsightKind;
  text: string;
  createdAt: number;
  sessionId?: string;
}>;

export type ProjectMeta = Readonly<{
  id: string;
  name: string;
  instructions?: string;
  createdAt: number;
}>;

export type SessionMeta = Readonly<{
  id: string;
  startedAt: number;
  endedAt?: number;
  title?: string;
  blockCount: number;
  agentCount: number;
  sourceLang?: LanguageCode;
  targetLang?: LanguageCode;
  projectId?: string;
}>;

export type UIState = {
  deviceName: string;
  modelId: string;
  intervalMs: number;
  status: "idle" | "connecting" | "recording" | "paused";
  contextLoaded: boolean;
  cost?: number;
  translationEnabled: boolean;
  canTranslate: boolean;
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
  analysisProviderOnly?: string;
  analysisReasoning: boolean;
  taskModelId: string;
  taskProviders: string[];
  utilityModelId: string;
  memoryModelId: string;
  vertexProject?: string;
  vertexLocation: string;
  contextFile: string;
  useContext: boolean;
  compact: boolean;
  debug: boolean;
  legacyAudio: boolean;
  translationEnabled: boolean;
  agentAutoApprove: boolean;
  micDevice?: string;
};

export type FontSize = "sm" | "md" | "lg";
export type FontFamily = "sans" | "mono";

export type AppConfig = {
  themeMode: ThemeMode;
  lightVariant: LightVariant;
  darkVariant: DarkVariant;
  fontSize: FontSize;
  fontFamily: FontFamily;
  direction: Direction;
  intervalMs: number;
  transcriptionProvider: TranscriptionProvider;
  transcriptionModelId: string;
  analysisProvider: AnalysisProvider;
  analysisModelId: string;
  analysisProviderOnly?: string;
  analysisReasoning: boolean;
  taskModelId: string;
  taskProviders: string[];
  utilityModelId: string;
  memoryModelId: string;
  vertexProject?: string;
  vertexLocation: string;
  contextFile: string;
  useContext: boolean;
  compact: boolean;
  debug: boolean;
  legacyAudio: boolean;
  translationEnabled: boolean;
  agentAutoApprove: boolean;
};

export type AppConfigOverrides = Partial<AppConfig>;

export type McpIntegrationProvider = "notion" | "linear";
export type McpIntegrationMode = "oauth" | "token";
export type McpIntegrationConnection = "connected" | "disconnected" | "error";

export type McpIntegrationStatus = Readonly<{
  provider: McpIntegrationProvider;
  mode: McpIntegrationMode;
  state: McpIntegrationConnection;
  enabled: boolean;
  label?: string;
  error?: string;
  lastConnectedAt?: number;
}>;

export type CustomMcpTransport = "streamable" | "sse";

export type McpToolInfo = {
  name: string;
  description?: string;
  isMutating: boolean;
};

export type McpProviderToolSummary = {
  /** "notion" | "linear" | "custom:<uuid>" */
  provider: string;
  tools: McpToolInfo[];
};

export type CustomMcpStatus = {
  id: string;
  name: string;
  url: string;
  transport: CustomMcpTransport;
  state: McpIntegrationConnection;
  error?: string;
  lastConnectedAt?: number;
};

const ENV = typeof process !== "undefined" ? process.env : undefined;

export const DEFAULT_VERTEX_MODEL_ID =
  ENV?.VERTEX_MODEL_ID ?? "gemini-3-flash-preview";
export const DEFAULT_VERTEX_LOCATION =
  ENV?.GOOGLE_VERTEX_PROJECT_LOCATION ?? "global";
export const DEFAULT_TRANSCRIPTION_MODEL_ID =
  ENV?.TRANSCRIPTION_MODEL_ID ?? "scribe_v2_realtime";
export const DEFAULT_WHISPER_MODEL_ID = "Xenova/whisper-small";
export { ANALYSIS_MODEL_PRESETS, getAnalysisModelPreset } from "./models";

export const DEFAULT_ANALYSIS_MODEL_ID =
  ENV?.ANALYSIS_MODEL_ID ?? "moonshotai/kimi-k2-thinking";
export const DEFAULT_TASK_MODEL_ID =
  ENV?.TODO_MODEL_ID ?? "openai/gpt-oss-120b";
export const DEFAULT_INTERVAL_MS = 2000;
export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_LIGHT_VARIANT: LightVariant = "warm";
export const DEFAULT_DARK_VARIANT: DarkVariant = "charcoal";
export const DEFAULT_FONT_SIZE: FontSize = "md";
export const DEFAULT_FONT_FAMILY: FontFamily = "sans";

function normalizeLightVariant(
  value: unknown,
  fallback: LightVariant
): LightVariant {
  switch (value) {
    case "warm":
    case "linen":
    case "ivory":
    case "petal":
    case "aqua":
      return value;
    case "paper":
      return "ivory";
    case "rose":
      return "petal";
    default:
      return fallback;
  }
}

function normalizeDarkVariant(
  value: unknown,
  fallback: DarkVariant
): DarkVariant {
  switch (value) {
    case "charcoal":
    case "steel":
    case "pitch-black":
    case "abyss":
      return value;
    case "dim":
      return "charcoal";
    case "zinc":
      return "steel";
    case "oled":
      return "pitch-black";
    case "midnight":
      return "abyss";
    default:
      return fallback;
  }
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  themeMode: DEFAULT_THEME_MODE,
  lightVariant: DEFAULT_LIGHT_VARIANT,
  darkVariant: DEFAULT_DARK_VARIANT,
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: DEFAULT_FONT_FAMILY,
  direction: "auto",
  intervalMs: DEFAULT_INTERVAL_MS,
  transcriptionProvider: "elevenlabs",
  transcriptionModelId: DEFAULT_TRANSCRIPTION_MODEL_ID,
  analysisProvider: "openrouter",
  analysisModelId: "moonshotai/kimi-k2-0905:exacto",
  analysisReasoning: false,
  taskModelId: DEFAULT_TASK_MODEL_ID,
  taskProviders: ["sambanova", "groq", "cerebras"],
  utilityModelId: DEFAULT_UTILITY_MODEL_ID,
  memoryModelId: DEFAULT_MEMORY_MODEL_ID,
  vertexProject: ENV?.GOOGLE_VERTEX_PROJECT_ID,
  vertexLocation: DEFAULT_VERTEX_LOCATION,
  contextFile: "context.md",
  useContext: false,
  compact: false,
  debug: !!ENV?.DEBUG,
  legacyAudio: false,
  translationEnabled: true,
  agentAutoApprove: false,
};

export function normalizeAppConfig(
  input?: AppConfigOverrides | null
): AppConfig {
  const merged: AppConfig = {
    ...DEFAULT_APP_CONFIG,
    ...(input ?? {}),
  };

  const themeMode: ThemeMode =
    merged.themeMode === "dark" ||
    merged.themeMode === "light" ||
    merged.themeMode === "system"
      ? merged.themeMode
      : DEFAULT_APP_CONFIG.themeMode;
  const rawLightVariant =
    (input as { lightVariant?: unknown } | null | undefined)?.lightVariant ??
    merged.lightVariant;
  const lightVariant = normalizeLightVariant(
    rawLightVariant,
    DEFAULT_APP_CONFIG.lightVariant
  );
  const rawDarkVariant =
    (input as { darkVariant?: unknown } | null | undefined)?.darkVariant ??
    merged.darkVariant;
  const darkVariant = normalizeDarkVariant(
    rawDarkVariant,
    DEFAULT_APP_CONFIG.darkVariant
  );
  const fontSize: FontSize =
    merged.fontSize === "sm" ||
    merged.fontSize === "md" ||
    merged.fontSize === "lg"
      ? merged.fontSize
      : DEFAULT_APP_CONFIG.fontSize;
  const fontFamily: FontFamily =
    merged.fontFamily === "sans" || merged.fontFamily === "mono"
      ? merged.fontFamily
      : DEFAULT_APP_CONFIG.fontFamily;
  const direction: Direction =
    merged.direction === "source-target" || merged.direction === "auto"
      ? merged.direction
      : DEFAULT_APP_CONFIG.direction;
  const transcriptionProvider: TranscriptionProvider =
    merged.transcriptionProvider === "google" ||
    merged.transcriptionProvider === "vertex" ||
    merged.transcriptionProvider === "elevenlabs" ||
    merged.transcriptionProvider === "whisper"
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
  const transcriptionModelId =
    merged.transcriptionModelId?.trim() ||
    DEFAULT_APP_CONFIG.transcriptionModelId;
  const analysisModelId =
    merged.analysisModelId?.trim() || DEFAULT_APP_CONFIG.analysisModelId;
  const analysisModelPreset = getAnalysisModelPreset(analysisModelId);
  const analysisProviderOnly =
    analysisModelPreset?.providerOnly ?? (merged.analysisProviderOnly?.trim() || undefined);
  const analysisReasoning = analysisModelPreset?.reasoning ?? !!merged.analysisReasoning;

  return {
    ...merged,
    themeMode,
    lightVariant,
    darkVariant,
    fontSize,
    fontFamily,
    direction,
    transcriptionProvider,
    analysisProvider,
    intervalMs,
    transcriptionModelId,
    analysisModelId,
    taskModelId: merged.taskModelId?.trim() || DEFAULT_APP_CONFIG.taskModelId,
    utilityModelId: merged.utilityModelId?.trim() || DEFAULT_APP_CONFIG.utilityModelId,
    memoryModelId: merged.memoryModelId?.trim() || DEFAULT_APP_CONFIG.memoryModelId,
    contextFile: merged.contextFile?.trim() || DEFAULT_APP_CONFIG.contextFile,
    vertexLocation:
      merged.vertexLocation?.trim() || DEFAULT_APP_CONFIG.vertexLocation,
    vertexProject: merged.vertexProject?.trim() || undefined,
    useContext: !!merged.useContext,
    compact: !!merged.compact,
    debug: !!merged.debug,
    legacyAudio: !!merged.legacyAudio,
    translationEnabled: !!merged.translationEnabled,
    agentAutoApprove: !!merged.agentAutoApprove,
    analysisProviderOnly,
    analysisReasoning,
    taskProviders:
      Array.isArray(merged.taskProviders) && merged.taskProviders.length > 0
        ? merged.taskProviders
        : DEFAULT_APP_CONFIG.taskProviders,
  };
}

// Agent types
export type AgentStatus = "running" | "completed" | "failed";
export type AgentKind = "analysis" | "custom";
export type AgentStepKind =
  | "thinking"
  | "tool-call"
  | "tool-result"
  | "text"
  | "user";

export type AgentQuestionOption = Readonly<{
  id: string;
  label: string;
}>;

export type AgentQuestion = Readonly<{
  id: string;
  prompt: string;
  options: AgentQuestionOption[];
  allow_multiple?: boolean;
}>;

export type AgentQuestionRequest = Readonly<{
  title?: string;
  questions: AgentQuestion[];
}>;

export type AgentQuestionSelection = Readonly<{
  questionId: string;
  selectedOptionIds: string[];
}>;

export type AgentToolApprovalRequest = Readonly<{
  id: string;
  toolName: string;
  provider: string;
  title: string;
  summary: string;
  input?: string;
}>;

export type AgentToolApprovalResponse = Readonly<{
  approvalId: string;
  approved: boolean;
}>;

export type AgentToolApprovalState =
  | "approval-requested"
  | "approval-responded"
  | "output-denied"
  | "output-available";

export type AgentStep = Readonly<{
  id: string;
  kind: AgentStepKind;
  content: string;
  toolName?: string;
  toolInput?: string;
  approvalId?: string;
  approvalState?: AgentToolApprovalState;
  approvalApproved?: boolean;
  createdAt: number;
}>;

export type Agent = {
  id: string;
  kind: AgentKind;
  taskId?: string;
  task: string;
  taskContext?: string;
  status: AgentStatus;
  steps: AgentStep[];
  result?: string;
  createdAt: number;
  completedAt?: number;
  sessionId?: string;
  archived?: boolean;
};

// Session event types for EventEmitter
export type SessionEvents = {
  "state-change": [state: UIState];
  "block-added": [block: TranscriptBlock];
  "block-updated": [block: TranscriptBlock];
  "blocks-cleared": [];
  "summary-updated": [summary: Summary | null];
  "final-summary-ready": [summary: FinalSummary];
  "final-summary-error": [error: string];
  "cost-updated": [cost: number];
  partial: [payload: { source: AudioSource | null; text: string }];
  status: [text: string];
  error: [error: string];
  "task-added": [task: TaskItem];
  "task-updated": [task: TaskItem];
  "task-suggested": [suggestion: TaskSuggestion];
  "insight-added": [insight: Insight];
  "insights-updated": [insights: Insight[]];
  "agent-started": [agent: Agent];
  "agent-step": [agentId: string, step: AgentStep];
  "agent-completed": [agentId: string, result: string];
  "agent-failed": [agentId: string, error: string];
  "agent-archived": [agentId: string];
  "agents-summary-ready": [summary: AgentsSummary];
  "agents-summary-error": [error: string];
  "session-title-generated": [sessionId: string, title: string];
  "agent-title-generated": [agentId: string, title: string];
};
