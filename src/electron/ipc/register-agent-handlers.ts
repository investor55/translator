import { ipcMain } from "electron";
import type {
  AppConfigOverrides,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
} from "../../core/types";
import type { EnsureSession, IpcDeps } from "./types";

type AgentDeps = IpcDeps & {
  ensureSession: EnsureSession;
};

export function registerAgentHandlers({
  db,
  ensureSession,
  sessionRef,
}: AgentDeps) {
  const approvalTokens = new Map<string, { todoId: string; expiresAt: number }>();
  const APPROVAL_TOKEN_TTL_MS = 60_000;

  function cleanupExpiredApprovalTokens() {
    const now = Date.now();
    for (const [token, grant] of approvalTokens.entries()) {
      if (grant.expiresAt <= now) {
        approvalTokens.delete(token);
      }
    }
  }

  function issueApprovalToken(todoId: string): string {
    cleanupExpiredApprovalTokens();
    const token = crypto.randomUUID();
    approvalTokens.set(token, {
      todoId,
      expiresAt: Date.now() + APPROVAL_TOKEN_TTL_MS,
    });
    return token;
  }

  function consumeApprovalToken(todoId: string, token?: string): boolean {
    cleanupExpiredApprovalTokens();
    if (!token) return false;
    const grant = approvalTokens.get(token);
    if (!grant) return false;
    if (grant.todoId !== todoId) return false;
    if (grant.expiresAt <= Date.now()) {
      approvalTokens.delete(token);
      return false;
    }
    approvalTokens.delete(token);
    return true;
  }

  function ensureLaunchApproval(todoId: string, approvalToken?: string): { ok: true } | { ok: false; error: string } {
    const todo = db.getTodo(todoId);
    if (!todo) return { ok: false, error: "Todo not found" };
    if (todo.size === "small") return { ok: true };
    if (!consumeApprovalToken(todoId, approvalToken)) {
      return { ok: false, error: "Approval required for large todo" };
    }
    return { ok: true };
  }

  ipcMain.handle("approve-large-todo", (_event, todoId: string) => {
    const todo = db.getTodo(todoId);
    if (!todo) return { ok: false, error: "Todo not found" };
    if (todo.size !== "large") {
      return { ok: false, error: "Todo does not require approval" };
    }
    return { ok: true, approvalToken: issueApprovalToken(todoId) };
  });

  ipcMain.handle(
    "launch-agent",
    (_event, todoId: string, task: string, taskContext?: string, approvalToken?: string) => {
      if (!sessionRef.current) return { ok: false, error: "No active session" };
      const approval = ensureLaunchApproval(todoId, approvalToken);
      if (!approval.ok) return approval;
      const agent = sessionRef.current.launchAgent(todoId, task, taskContext);
      if (!agent) return { ok: false, error: "Agent system unavailable (EXA_API_KEY not set)" };
      return { ok: true, agent };
    },
  );

  ipcMain.handle(
    "launch-agent-in-session",
    async (
      _event,
      sessionId: string,
      todoId: string,
      task: string,
      taskContext?: string,
      appConfig?: AppConfigOverrides,
      approvalToken?: string,
    ) => {
      const ensured = await ensureSession(sessionId, appConfig);
      if (!ensured.ok) return ensured;
      if (!sessionRef.current) return { ok: false, error: "Could not load session" };
      const approval = ensureLaunchApproval(todoId, approvalToken);
      if (!approval.ok) return approval;
      const agent = sessionRef.current.launchAgent(todoId, task, taskContext);
      if (!agent) return { ok: false, error: "Agent system unavailable (EXA_API_KEY not set)" };
      return { ok: true, agent };
    },
  );

  ipcMain.handle("archive-agent", (_event, agentId: string) => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    const archived = sessionRef.current.archiveAgent(agentId);
    if (!archived) return { ok: false, error: "Agent not found or still running" };
    return { ok: true };
  });

  ipcMain.handle("relaunch-agent", (_event, agentId: string) => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    const agent = sessionRef.current.relaunchAgent(agentId);
    if (!agent) return { ok: false, error: "Agent not found or still running" };
    return { ok: true, agent };
  });

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

  ipcMain.handle("answer-agent-question", (_event, agentId: string, answers: AgentQuestionSelection[]) => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    return sessionRef.current.answerAgentQuestion(agentId, answers);
  });

  ipcMain.handle(
    "respond-agent-tool-approval",
    (_event, agentId: string, response: AgentToolApprovalResponse) => {
      if (!sessionRef.current) return { ok: false, error: "No active session" };
      return sessionRef.current.answerAgentToolApproval(agentId, response);
    },
  );

  ipcMain.handle(
    "answer-agent-question-in-session",
    async (
      _event,
      sessionId: string,
      agentId: string,
      answers: AgentQuestionSelection[],
      appConfig?: AppConfigOverrides,
    ) => {
      const ensured = await ensureSession(sessionId, appConfig);
      if (!ensured.ok) return ensured;
      if (!sessionRef.current) return { ok: false, error: "Could not load session" };
      return sessionRef.current.answerAgentQuestion(agentId, answers);
    },
  );

  ipcMain.handle(
    "respond-agent-tool-approval-in-session",
    async (
      _event,
      sessionId: string,
      agentId: string,
      response: AgentToolApprovalResponse,
      appConfig?: AppConfigOverrides,
    ) => {
      const ensured = await ensureSession(sessionId, appConfig);
      if (!ensured.ok) return ensured;
      if (!sessionRef.current) return { ok: false, error: "Could not load session" };
      return sessionRef.current.answerAgentToolApproval(agentId, response);
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
