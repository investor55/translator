import type { BrowserWindow } from "electron";
import type { AppDatabase } from "../core/db/db";
import { validateEnv } from "../core/config";
import { log } from "../core/logger";
import { Session } from "../core/session";
import { toReadableError } from "../core/text/text-utils";
import type { AppConfigOverrides, LanguageCode } from "../core/types";
import { registerAgentHandlers } from "./ipc/register-agent-handlers";
import { registerSessionHandlers } from "./ipc/register-session-handlers";
import { registerTodoInsightHandlers } from "./ipc/register-todo-insight-handlers";
import { buildSessionConfig, shutdownCurrentSession, wireSessionEvents } from "./ipc/ipc-utils";
import type { EnsureSession, SessionRef } from "./ipc/types";

const sessionRef: SessionRef = { current: null };
let registeredDb: AppDatabase | null = null;

export function shutdownSessionOnAppQuit() {
  if (!registeredDb) return;
  void shutdownCurrentSession(sessionRef, registeredDb);
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null, db: AppDatabase) {
  registeredDb = db;

  const ensureSession: EnsureSession = async (
    sessionId: string,
    appConfig?: AppConfigOverrides,
  ) => {
    if (sessionRef.current && sessionRef.current.sessionId === sessionId) {
      return { ok: true };
    }

    await shutdownCurrentSession(sessionRef, db);

    const meta = db.getSession(sessionId);
    if (!meta) {
      return { ok: false, error: `Session ${sessionId} not found` };
    }

    const sourceLang = (meta.sourceLang as LanguageCode) ?? "ko";
    const targetLang = (meta.targetLang as LanguageCode) ?? "en";
    const config = buildSessionConfig(sourceLang, targetLang, appConfig);

    try {
      validateEnv(config);
    } catch (error) {
      return { ok: false, error: toReadableError(error) };
    }

    const activeSession = new Session(config, db, sessionId);
    sessionRef.current = activeSession;
    wireSessionEvents(sessionRef, activeSession, getWindow, db);

    try {
      await activeSession.initialize();
      return { ok: true };
    } catch (error) {
      log("ERROR", `Session ensure failed: ${toReadableError(error)}`);
      return { ok: false, error: toReadableError(error) };
    }
  };

  registerSessionHandlers({ db, getWindow, sessionRef });
  registerTodoInsightHandlers({ db, getWindow, sessionRef, ensureSession });
  registerAgentHandlers({ db, getWindow, sessionRef, ensureSession });
}
