import { ipcMain } from "electron";
import type { AppConfigOverrides } from "../../core/types";
import type { EnsureSession, IpcDeps } from "./types";

type AgentDeps = IpcDeps & {
  ensureSession: EnsureSession;
};

export function registerAgentHandlers({
  db,
  ensureSession,
  sessionRef,
}: AgentDeps) {
  ipcMain.handle("launch-agent", (_event, todoId: string, task: string) => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    const agent = sessionRef.current.launchAgent(todoId, task);
    if (!agent) return { ok: false, error: "Agent system unavailable (EXA_API_KEY not set)" };
    return { ok: true, agent };
  });

  ipcMain.handle(
    "launch-agent-in-session",
    async (
      _event,
      sessionId: string,
      todoId: string,
      task: string,
      appConfig?: AppConfigOverrides,
    ) => {
      const ensured = await ensureSession(sessionId, appConfig);
      if (!ensured.ok) return ensured;
      if (!sessionRef.current) return { ok: false, error: "Could not load session" };
      const agent = sessionRef.current.launchAgent(todoId, task);
      if (!agent) return { ok: false, error: "Agent system unavailable (EXA_API_KEY not set)" };
      return { ok: true, agent };
    },
  );

  ipcMain.handle("follow-up-agent", (_event, agentId: string, question: string) => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    const started = sessionRef.current.followUpAgent(agentId, question);
    if (!started) return { ok: false, error: "Agent not found or still running" };
    return { ok: true };
  });

  ipcMain.handle(
    "follow-up-agent-in-session",
    async (
      _event,
      sessionId: string,
      agentId: string,
      question: string,
      appConfig?: AppConfigOverrides,
    ) => {
      const ensured = await ensureSession(sessionId, appConfig);
      if (!ensured.ok) return ensured;
      if (!sessionRef.current) return { ok: false, error: "Could not load session" };
      const started = sessionRef.current.followUpAgent(agentId, question);
      if (!started) return { ok: false, error: "Agent not found or still running" };
      return { ok: true };
    },
  );

  ipcMain.handle("cancel-agent", (_event, agentId: string) => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    const cancelled = sessionRef.current.cancelAgent(agentId);
    if (!cancelled) return { ok: false, error: "Agent not found or already finished" };
    return { ok: true };
  });

  ipcMain.handle("get-agents", () => {
    if (!sessionRef.current) return [];
    return sessionRef.current.getAgents();
  });

  ipcMain.handle("get-session-agents", (_event, sessionId: string) => {
    return db.getAgentsForSession(sessionId);
  });
}
