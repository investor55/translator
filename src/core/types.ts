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
export type LightVariant = "warm" | "linen";

export type TranscriptionProvider = "google" | "vertex" | "elevenlabs" | "whisper";
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

export type FinalSummary = {
  narrative: string;       // prose paragraph summary of the entire conversation
  actionItems: string[];   // extracted action items / todos
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

export type TodoItem = Readonly<{
  id: string;
  text: string;
  details?: string;
  size: TodoSize;
  completed: boolean;
  source: "ai" | "manual";
  createdAt: number;
  completedAt?: number;
  sessionId?: string;
}>;

export type TodoSize = "small" | "large";

export type TodoSuggestion = Readonly<{
  id: string;
  text: string;
  details?: string;
  transcriptExcerpt?: string;
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
  todoModelId: string;
  todoProviders: string[];
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
  todoModelId: string;
  todoProviders: string[];
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
export const DEFAULT_ANALYSIS_MODEL_ID =
  ENV?.ANALYSIS_MODEL_ID ?? "moonshotai/kimi-k2-thinking";
export const DEFAULT_TODO_MODEL_ID =
  ENV?.TODO_MODEL_ID ?? "openai/gpt-oss-120b";
export const DEFAULT_INTERVAL_MS = 2000;
export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_LIGHT_VARIANT: LightVariant = "warm";
export const DEFAULT_FONT_SIZE: FontSize = "md";
export const DEFAULT_FONT_FAMILY: FontFamily = "sans";

export const DEFAULT_APP_CONFIG: AppConfig = {
  themeMode: DEFAULT_THEME_MODE,
  lightVariant: DEFAULT_LIGHT_VARIANT,
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: DEFAULT_FONT_FAMILY,
  direction: "auto",
  intervalMs: DEFAULT_INTERVAL_MS,
  transcriptionProvider: "elevenlabs",
  transcriptionModelId: DEFAULT_TRANSCRIPTION_MODEL_ID,
  analysisProvider: "openrouter",
  analysisModelId: "moonshotai/kimi-k2-0905:exacto",
  analysisReasoning: false,
  todoModelId: DEFAULT_TODO_MODEL_ID,
  todoProviders: ["sambanova"],
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

export function normalizeAppConfig(input?: AppConfigOverrides | null): AppConfig {
  const merged: AppConfig = {
    ...DEFAULT_APP_CONFIG,
    ...(input ?? {}),
  };

  const themeMode: ThemeMode =
    merged.themeMode === "dark" || merged.themeMode === "light" || merged.themeMode === "system"
      ? merged.themeMode
      : DEFAULT_APP_CONFIG.themeMode;
  const lightVariant: LightVariant =
    merged.lightVariant === "warm" || merged.lightVariant === "linen"
      ? merged.lightVariant
      : DEFAULT_APP_CONFIG.lightVariant;
  const fontSize: FontSize =
    merged.fontSize === "sm" || merged.fontSize === "md" || merged.fontSize === "lg"
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
    merged.transcriptionModelId?.trim() || DEFAULT_APP_CONFIG.transcriptionModelId;
  const rawAnalysisProviderOnly = merged.analysisProviderOnly?.trim();
  // Backward compatibility: older defaults used "Groq" (capitalized), which can
  // break provider filtering. Treat that legacy value as "no provider pin".
  const analysisProviderOnly =
    rawAnalysisProviderOnly && rawAnalysisProviderOnly !== "Groq"
      ? rawAnalysisProviderOnly.toLowerCase()
      : undefined;

  return {
    ...merged,
    themeMode,
    lightVariant,
    fontSize,
    fontFamily,
    direction,
    transcriptionProvider,
    analysisProvider,
    intervalMs,
    transcriptionModelId,
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
    agentAutoApprove: !!merged.agentAutoApprove,
    analysisProviderOnly,
    analysisReasoning: !!merged.analysisReasoning,
    todoProviders: Array.isArray(merged.todoProviders) && merged.todoProviders.length > 0
      ? merged.todoProviders
      : DEFAULT_APP_CONFIG.todoProviders,
  };
}

// Agent types
export type AgentStatus = "running" | "completed" | "failed";
export type AgentStepKind = "thinking" | "tool-call" | "tool-result" | "text" | "user";

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
  todoId: string;
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
  "partial": [payload: { source: AudioSource | null; text: string }];
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
  "agent-archived": [agentId: string];
  "agents-summary-ready": [summary: AgentsSummary];
  "agents-summary-error": [error: string];
  "session-title-generated": [sessionId: string, title: string];
};
