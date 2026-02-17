import { ipcMain, systemPreferences, type BrowserWindow } from "electron";
import { Session } from "../core/session";
import { validateEnv } from "../core/config";
import { log } from "../core/logger";
import { toReadableError } from "../core/text-utils";
import { listMicDevices } from "../audio";
import type { AppDatabase } from "../core/db";
import type { SessionConfig, LanguageCode, UIState, TranscriptBlock, Summary, TodoItem, Insight } from "../core/types";
import { SUPPORTED_LANGUAGES, DEFAULT_VERTEX_MODEL_ID, DEFAULT_VERTEX_LOCATION, DEFAULT_INTERVAL_MS } from "../core/types";

let session: Session | null = null;

function send(getWindow: () => BrowserWindow | null, channel: string, ...args: unknown[]) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null, db: AppDatabase) {
  ipcMain.handle("get-languages", () => {
    return SUPPORTED_LANGUAGES;
  });

  ipcMain.handle("start-session", async (_event, sourceLang: LanguageCode, targetLang: LanguageCode) => {
    if (session) {
      db.endSession(session.sessionId);
      session.shutdown();
      session = null;
    }

    const config: SessionConfig = {
      direction: "auto",
      sourceLang,
      targetLang,
      intervalMs: DEFAULT_INTERVAL_MS,
      vertexModelId: DEFAULT_VERTEX_MODEL_ID,
      vertexProject: process.env.GOOGLE_VERTEX_PROJECT_ID,
      vertexLocation: DEFAULT_VERTEX_LOCATION,
      contextFile: "context.md",
      useContext: true,
      compact: false,
      debug: !!process.env.DEBUG,
      legacyAudio: false,
      translationEnabled: true,
    };

    try {
      validateEnv(config as Parameters<typeof validateEnv>[0]);
    } catch (error) {
      return { ok: false, error: toReadableError(error) };
    }

    session = new Session(config, db);
    db.createSession(session.sessionId, sourceLang, targetLang);

    session.events.on("state-change", (state: UIState) => {
      send(getWindow, "session:state-change", state);
    });
    session.events.on("block-added", (block: TranscriptBlock) => {
      db.insertBlock(session!.sessionId, block);
      send(getWindow, "session:block-added", block);
    });
    session.events.on("block-updated", (block: TranscriptBlock) => {
      send(getWindow, "session:block-updated", block);
    });
    session.events.on("blocks-cleared", () => {
      send(getWindow, "session:blocks-cleared");
    });
    session.events.on("summary-updated", (summary: Summary | null) => {
      send(getWindow, "session:summary-updated", summary);
    });
    session.events.on("cost-updated", (cost: number) => {
      send(getWindow, "session:cost-updated", cost);
    });
    session.events.on("status", (text: string) => {
      send(getWindow, "session:status", text);
    });
    session.events.on("error", (text: string) => {
      send(getWindow, "session:error", text);
    });
    session.events.on("todo-added", (todo: TodoItem) => {
      send(getWindow, "session:todo-added", todo);
    });
    session.events.on("insight-added", (insight) => {
      send(getWindow, "session:insight-added", insight);
    });

    try {
      await session.initialize();
      return { ok: true };
    } catch (error) {
      log("ERROR", `Session init failed: ${toReadableError(error)}`);
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
      await session.startRecording();
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

  ipcMain.handle("shutdown-session", () => {
    if (session) {
      db.endSession(session.sessionId);
      session.shutdown();
      session = null;
    }
    return { ok: true };
  });
}
