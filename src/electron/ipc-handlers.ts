import { app, type BrowserWindow } from "electron";
import type { AppDatabase } from "../core/db/db";
import { validateEnv } from "../core/config";
import { log } from "../core/logger";
import { Session } from "../core/session";
import { setWhisperRemoteRuntime } from "../core/transcription/whisper-local";
import { toReadableError } from "../core/text/text-utils";
import type { AppConfigOverrides } from "../core/types";
import { registerAgentHandlers } from "./ipc/register-agent-handlers";
import { registerProjectHandlers } from "./ipc/register-project-handlers";
import { registerSessionHandlers } from "./ipc/register-session-handlers";
import { registerTodoInsightHandlers } from "./ipc/register-todo-insight-handlers";
import { registerIntegrationHandlers } from "./ipc/register-integration-handlers";
import { registerElectronWhisperGpuBridge } from "./ipc/whisper-gpu-bridge";
import { buildSessionConfig, shutdownCurrentSession, wireSessionEvents } from "./ipc/ipc-utils";
import type { EnsureSession, SessionRef } from "./ipc/types";
import { createIntegrationManager } from "./integrations";
import type { IntegrationManager } from "./integrations/types";

const sessionRef: SessionRef = { current: null };
let registeredDb: AppDatabase | null = null;
let disposeWhisperGpuBridge: (() => void) | null = null;
let integrationManager: IntegrationManager | null = null;

export function shutdownSessionOnAppQuit() {
  if (disposeWhisperGpuBridge) {
    disposeWhisperGpuBridge();
    disposeWhisperGpuBridge = null;
    setWhisperRemoteRuntime(null);
  }
  if (!registeredDb) return;
  void shutdownCurrentSession(sessionRef, registeredDb);
  void integrationManager?.dispose();
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null, db: AppDatabase) {
  registeredDb = db;
  if (disposeWhisperGpuBridge) {
    disposeWhisperGpuBridge();
    disposeWhisperGpuBridge = null;
  }

  const whisperGpuBridge = registerElectronWhisperGpuBridge(getWindow);
  setWhisperRemoteRuntime(whisperGpuBridge.runtime);
  disposeWhisperGpuBridge = () => {
    whisperGpuBridge.dispose();
    setWhisperRemoteRuntime(null);
  };

  if (integrationManager) {
    void integrationManager.dispose();
  }
  integrationManager = createIntegrationManager(app.getPath("userData"));
  const manager = integrationManager;

  const ensureSession: EnsureSession = async (
    sessionId: string,
    appConfig?: AppConfigOverrides,
  ) => {
    if (sessionRef.current?.sessionId === sessionId) {
      if (!appConfig) {
        return { ok: true };
      }

      const currentSession = sessionRef.current;
      const desiredConfig = buildSessionConfig(
        currentSession.config.sourceLang,
        currentSession.config.targetLang,
        appConfig,
      );
      const currentConfigSerialized = JSON.stringify(currentSession.config);
      const desiredConfigSerialized = JSON.stringify(desiredConfig);
      if (currentConfigSerialized === desiredConfigSerialized) {
        return { ok: true };
      }

      await shutdownCurrentSession(sessionRef, db);

      try {
        validateEnv(desiredConfig);
      } catch (error) {
        return { ok: false, error: toReadableError(error) };
      }

      const activeSession = new Session(desiredConfig, db, sessionId, {
        getExternalTools: manager.getExternalTools,
      });
      sessionRef.current = activeSession;
      wireSessionEvents(sessionRef, activeSession, getWindow, db);

      try {
        await activeSession.initialize();
        return { ok: true };
      } catch (error) {
        log("ERROR", `Session ensure failed: ${toReadableError(error)}`);
        return { ok: false, error: toReadableError(error) };
      }
    }

    await shutdownCurrentSession(sessionRef, db);

    const meta = db.getSession(sessionId);
    if (!meta) {
      return { ok: false, error: `Session ${sessionId} not found` };
    }

    const sourceLang = meta.sourceLang ?? "ko";
    const targetLang = meta.targetLang ?? "en";
    const config = buildSessionConfig(sourceLang, targetLang, appConfig);

    try {
      validateEnv(config);
    } catch (error) {
      return { ok: false, error: toReadableError(error) };
    }

    const activeSession = new Session(config, db, sessionId, {
      getExternalTools: manager.getExternalTools,
    });
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

  registerProjectHandlers({ db });
  registerSessionHandlers({
    db,
    getWindow,
    sessionRef,
    getExternalTools: manager.getExternalTools,
  });
  registerTodoInsightHandlers({ db, getWindow, sessionRef, ensureSession });
  registerAgentHandlers({ db, getWindow, sessionRef, ensureSession });
  registerIntegrationHandlers(manager);
}
