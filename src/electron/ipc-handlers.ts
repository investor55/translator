import { ipcMain, systemPreferences, type BrowserWindow } from "electron";
import { Session } from "../core/session";
import { validateEnv } from "../core/config";
import { log } from "../core/logger";
import { toReadableError } from "../core/text-utils";
import { listMicDevices } from "../audio";
import type { AppDatabase } from "../core/db";
import type { SessionConfig, LanguageCode, UIState, TranscriptBlock, Summary, TodoItem, TodoSuggestion, Insight, Agent, AgentStep } from "../core/types";
import { SUPPORTED_LANGUAGES, DEFAULT_TRANSCRIPTION_MODEL_ID, DEFAULT_ANALYSIS_MODEL_ID, DEFAULT_VERTEX_LOCATION, DEFAULT_INTERVAL_MS } from "../core/types";

let session: Session | null = null;

function send(getWindow: () => BrowserWindow | null, channel: string, ...args: unknown[]) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

function wireSessionEvents(s: Session, getWindow: () => BrowserWindow | null, db: AppDatabase) {
  s.events.on("state-change", (state: UIState) => {
    send(getWindow, "session:state-change", state);
  });
  s.events.on("block-added", (block: TranscriptBlock) => {
    db.insertBlock(s.sessionId, block);
    send(getWindow, "session:block-added", block);
  });
  s.events.on("block-updated", (block: TranscriptBlock) => {
    send(getWindow, "session:block-updated", block);
  });
  s.events.on("blocks-cleared", () => {
    send(getWindow, "session:blocks-cleared");
  });
  s.events.on("summary-updated", (summary: Summary | null) => {
    send(getWindow, "session:summary-updated", summary);
  });
  s.events.on("cost-updated", (cost: number) => {
    send(getWindow, "session:cost-updated", cost);
  });
  s.events.on("status", (text: string) => {
    send(getWindow, "session:status", text);
  });
  s.events.on("error", (text: string) => {
    send(getWindow, "session:error", text);
  });
  s.events.on("todo-added", (todo: TodoItem) => {
    send(getWindow, "session:todo-added", todo);
  });
  s.events.on("todo-suggested", (suggestion: TodoSuggestion) => {
    send(getWindow, "session:todo-suggested", suggestion);
  });
  s.events.on("insight-added", (insight) => {
    send(getWindow, "session:insight-added", insight);
  });
  s.events.on("agent-started", (agent: Agent) => {
    send(getWindow, "session:agent-started", agent);
  });
  s.events.on("agent-step", (agentId: string, step: AgentStep) => {
    send(getWindow, "session:agent-step", agentId, step);
  });
  s.events.on("agent-completed", (agentId: string, result: string) => {
    send(getWindow, "session:agent-completed", agentId, result);
  });
  s.events.on("agent-failed", (agentId: string, error: string) => {
    send(getWindow, "session:agent-failed", agentId, error);
  });
}

function buildConfig(sourceLang: LanguageCode, targetLang: LanguageCode): SessionConfig {
  return {
    direction: "auto",
    sourceLang,
    targetLang,
    intervalMs: DEFAULT_INTERVAL_MS,
    transcriptionProvider: "vertex",
    transcriptionModelId: DEFAULT_TRANSCRIPTION_MODEL_ID,
    analysisProvider: "openrouter",
    analysisModelId: DEFAULT_ANALYSIS_MODEL_ID,
    vertexProject: process.env.GOOGLE_VERTEX_PROJECT_ID,
    vertexLocation: DEFAULT_VERTEX_LOCATION,
    contextFile: "context.md",
    useContext: false,
    compact: false,
    debug: !!process.env.DEBUG,
    legacyAudio: false,
    translationEnabled: true,
  };
}

function shutdownCurrentSession(db: AppDatabase) {
  if (session) {
    db.endSession(session.sessionId);
    session.shutdown();
    session = null;
  }
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null, db: AppDatabase) {
  ipcMain.handle("get-languages", () => {
    return SUPPORTED_LANGUAGES;
  });

  ipcMain.handle("start-session", async (_event, sourceLang: LanguageCode, targetLang: LanguageCode) => {
    shutdownCurrentSession(db);

    const config = buildConfig(sourceLang, targetLang);

    try {
      validateEnv(config);
    } catch (error) {
      return { ok: false, error: toReadableError(error) };
    }

    // Session reuse: if last session was truly empty (no blocks, no agents) and not ended, reuse it
    const recent = db.getMostRecentSession();
    const recentAgents = recent ? db.getAgentsForSession(recent.id) : [];
    let sessionId: string;
    if (recent && recent.blockCount === 0 && recentAgents.length === 0 && !recent.endedAt) {
      db.reuseSession(recent.id, sourceLang, targetLang);
      sessionId = recent.id;
      log("INFO", `Reusing empty session: ${sessionId}`);
    } else {
      sessionId = crypto.randomUUID();
      db.createSession(sessionId, sourceLang, targetLang);
    }

    session = new Session(config, db, sessionId);
    wireSessionEvents(session, getWindow, db);

    try {
      await session.initialize();
      return { ok: true, sessionId: session.sessionId };
    } catch (error) {
      log("ERROR", `Session init failed: ${toReadableError(error)}`);
      return { ok: false, error: toReadableError(error) };
    }
  });

  ipcMain.handle("resume-session", async (_event, sessionId: string) => {
    shutdownCurrentSession(db);

    const meta = db.getSession(sessionId);
    if (!meta) {
      return { ok: false, error: `Session ${sessionId} not found` };
    }

    const sourceLang = meta.sourceLang ?? "ko";
    const targetLang = meta.targetLang ?? "en";
    const config = buildConfig(sourceLang as LanguageCode, targetLang as LanguageCode);

    try {
      validateEnv(config);
    } catch (error) {
      return { ok: false, error: toReadableError(error) };
    }

    session = new Session(config, db, sessionId);
    wireSessionEvents(session, getWindow, db);

    try {
      await session.initialize();
      return {
        ok: true,
        sessionId,
        blocks: db.getBlocksForSession(sessionId),
        todos: db.getTodosForSession(sessionId),
        insights: db.getInsightsForSession(sessionId),
        agents: db.getAgentsForSession(sessionId),
      };
    } catch (error) {
      log("ERROR", `Session resume failed: ${toReadableError(error)}`);
      return { ok: false, error: toReadableError(error) };
    }
  });

  ipcMain.handle("start-recording", async () => {
    if (!session) return { ok: false, error: "No active session" };
    await session.startRecording();
    return { ok: true };
  });

  ipcMain.handle("stop-recording", () => {
    if (!session) return { ok: false, error: "No active session" };
    session.stopRecording();
    return { ok: true };
  });

  ipcMain.handle("toggle-recording", async () => {
    if (!session) return { ok: false, error: "No active session" };
    if (session.recording) {
      session.stopRecording();
    } else {
      await session.startRecording(true);
    }
    return { ok: true, recording: session.recording };
  });

  ipcMain.handle("toggle-mic", async () => {
    if (!session) return { ok: false, error: "No active session" };
    if (session.micEnabled) {
      session.stopMic();
      return { ok: true, micEnabled: false, captureInRenderer: false };
    }

    // Request microphone permission on macOS
    if (process.platform === "darwin") {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status !== "granted") {
        const granted = await systemPreferences.askForMediaAccess("microphone");
        if (!granted) {
          return { ok: false, error: "Microphone permission denied. Grant access in System Settings > Privacy & Security > Microphone." };
        }
      }
    }

    // Use renderer-based capture (Web Audio API) — avoids macOS TCC issues with ffmpeg subprocess
    session.startMicFromIPC();
    return { ok: true, micEnabled: true, captureInRenderer: true };
  });

  // Fire-and-forget handler for mic audio data streamed from renderer
  ipcMain.on("mic-audio-data", (_event, data: ArrayBuffer) => {
    if (session?.micEnabled) {
      session.feedMicAudio(Buffer.from(data));
    }
  });

  ipcMain.handle("toggle-translation", () => {
    if (!session) return { ok: false, error: "No active session" };
    const enabled = session.toggleTranslation();
    return { ok: true, enabled };
  });

  ipcMain.handle("list-mic-devices", async () => {
    try {
      return await listMicDevices();
    } catch {
      return [];
    }
  });

  // Persistence: Todos
  ipcMain.handle("get-todos", () => {
    return db.getTodos();
  });

  ipcMain.handle("get-session-todos", (_event, sessionId: string) => {
    return db.getTodosForSession(sessionId);
  });

  ipcMain.handle("add-todo", (_event, todo: TodoItem) => {
    db.insertTodo(todo);
    return { ok: true };
  });

  ipcMain.handle("toggle-todo", (_event, id: string) => {
    const todos = db.getTodos();
    const todo = todos.find((t) => t.id === id);
    if (!todo) return { ok: false, error: "Todo not found" };
    db.updateTodo(id, !todo.completed);
    return { ok: true };
  });

  // Persistence: Sessions
  ipcMain.handle("get-sessions", (_event, limit?: number) => {
    return db.getSessions(limit);
  });

  ipcMain.handle("get-session-blocks", (_event, sessionId: string) => {
    return db.getBlocksForSession(sessionId);
  });

  ipcMain.handle("delete-session", (_event, id: string) => {
    db.deleteSession(id);
    return { ok: true };
  });

  // Persistence: Insights
  ipcMain.handle("get-insights", (_event, limit?: number) => {
    return db.getRecentInsights(limit);
  });

  ipcMain.handle("get-session-insights", (_event, sessionId: string) => {
    return db.getInsightsForSession(sessionId);
  });

  ipcMain.handle("launch-agent", (_event, todoId: string, task: string) => {
    if (!session) return { ok: false, error: "No active session" };
    const agent = session.launchAgent(todoId, task);
    if (!agent) return { ok: false, error: "Agent system unavailable (EXA_API_KEY not set)" };
    return { ok: true, agent };
  });

  ipcMain.handle("follow-up-agent", (_event, agentId: string, question: string) => {
    if (!session) return { ok: false, error: "No active session" };
    const started = session.followUpAgent(agentId, question);
    if (!started) return { ok: false, error: "Agent not found or still running" };
    return { ok: true };
  });

  ipcMain.handle("cancel-agent", (_event, agentId: string) => {
    if (!session) return { ok: false, error: "No active session" };
    const cancelled = session.cancelAgent(agentId);
    if (!cancelled) return { ok: false, error: "Agent not found or already finished" };
    return { ok: true };
  });

  ipcMain.handle("get-agents", () => {
    if (!session) return [];
    return session.getAgents();
  });

  ipcMain.handle("get-session-agents", (_event, sessionId: string) => {
    return db.getAgentsForSession(sessionId);
  });

  ipcMain.handle("shutdown-session", () => {
    shutdownCurrentSession(db);
    return { ok: true };
  });
}
