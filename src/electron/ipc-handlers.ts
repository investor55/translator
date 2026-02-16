import { ipcMain, type BrowserWindow } from "electron";
import { Session } from "../core/session";
import { validateEnv } from "../core/config";
import { log } from "../core/logger";
import { toReadableError } from "../core/text-utils";
import type { SessionConfig, LanguageCode, UIState, TranscriptBlock, Summary } from "../core/types";
import { SUPPORTED_LANGUAGES, DEFAULT_VERTEX_MODEL_ID, DEFAULT_VERTEX_LOCATION, DEFAULT_INTERVAL_MS } from "../core/types";

let session: Session | null = null;

function send(getWindow: () => BrowserWindow | null, channel: string, ...args: unknown[]) {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null) {
  ipcMain.handle("get-languages", () => {
    return SUPPORTED_LANGUAGES;
  });

  ipcMain.handle("start-session", async (_event, sourceLang: LanguageCode, targetLang: LanguageCode) => {
    if (session) {
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
    };

    try {
      validateEnv(config as Parameters<typeof validateEnv>[0]);
    } catch (error) {
      return { ok: false, error: toReadableError(error) };
    }

    session = new Session(config);

    session.events.on("state-change", (state: UIState) => {
      send(getWindow, "session:state-change", state);
    });
    session.events.on("block-added", (block: TranscriptBlock) => {
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

  ipcMain.handle("shutdown-session", () => {
    if (session) {
      session.shutdown();
      session = null;
    }
    return { ok: true };
  });
}
