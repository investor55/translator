import type { BrowserWindow } from "electron";
import type { AppDatabase } from "../../core/db";
import { Session } from "../../core/session";
import type {
  Agent,
  AgentStep,
  AppConfigOverrides,
  LanguageCode,
  SessionConfig,
  Summary,
  TodoItem,
  TodoSuggestion,
  TranscriptBlock,
  UIState,
} from "../../core/types";
import { normalizeAppConfig } from "../../core/types";
import type { SessionRef } from "./types";

export function sendToRenderer(
  getWindow: () => BrowserWindow | null,
  channel: string,
  ...args: unknown[]
) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

export function buildSessionConfig(
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  appConfig?: AppConfigOverrides,
): SessionConfig {
  const config = normalizeAppConfig(appConfig);
  return {
    direction: config.direction,
    sourceLang,
    targetLang,
    intervalMs: config.intervalMs,
    transcriptionProvider: config.transcriptionProvider,
    transcriptionModelId: config.transcriptionModelId,
    analysisProvider: config.analysisProvider,
    analysisModelId: config.analysisModelId,
    todoModelId: config.todoModelId,
    vertexProject: config.vertexProject ?? process.env.GOOGLE_VERTEX_PROJECT_ID,
    vertexLocation: config.vertexLocation,
    contextFile: config.contextFile,
    useContext: config.useContext,
    compact: config.compact,
    debug: config.debug,
    legacyAudio: config.legacyAudio,
    translationEnabled: config.translationEnabled,
  };
}

export function wireSessionEvents(
  sessionRef: SessionRef,
  activeSession: Session,
  getWindow: () => BrowserWindow | null,
  db: AppDatabase,
) {
  const isCurrentSession = () => sessionRef.current?.sessionId === activeSession.sessionId;

  activeSession.events.on("state-change", (state: UIState) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:state-change", state);
  });
  activeSession.events.on("block-added", (block: TranscriptBlock) => {
    if (!isCurrentSession()) return;
    db.insertBlock(activeSession.sessionId, block);
    sendToRenderer(getWindow, "session:block-added", block);
  });
  activeSession.events.on("block-updated", (block: TranscriptBlock) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:block-updated", block);
  });
  activeSession.events.on("blocks-cleared", () => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:blocks-cleared");
  });
  activeSession.events.on("summary-updated", (summary: Summary | null) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:summary-updated", summary);
  });
  activeSession.events.on("cost-updated", (cost: number) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:cost-updated", cost);
  });
  activeSession.events.on("status", (text: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:status", text);
  });
  activeSession.events.on("error", (text: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:error", text);
  });
  activeSession.events.on("todo-added", (todo: TodoItem) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:todo-added", todo);
  });
  activeSession.events.on("todo-suggested", (suggestion: TodoSuggestion) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:todo-suggested", suggestion);
  });
  activeSession.events.on("insight-added", (insight) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:insight-added", insight);
  });
  activeSession.events.on("agent-started", (agent: Agent) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agent-started", agent);
  });
  activeSession.events.on("agent-step", (agentId: string, step: AgentStep) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agent-step", agentId, step);
  });
  activeSession.events.on("agent-completed", (agentId: string, result: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agent-completed", agentId, result);
  });
  activeSession.events.on("agent-failed", (agentId: string, error: string) => {
    if (!isCurrentSession()) return;
    sendToRenderer(getWindow, "session:agent-failed", agentId, error);
  });
}

export function shutdownCurrentSession(sessionRef: SessionRef, db: AppDatabase) {
  if (sessionRef.current) {
    const activeSession = sessionRef.current;
    sessionRef.current = null;
    activeSession.shutdown();
    db.endSession(activeSession.sessionId);
  }
}
