import { EventEmitter } from "node:events";
import type { ModelMessage } from "ai";
import { generateObject } from "ai";
import { buildAgentInitialUserPrompt, runAgent, continueAgent } from "./agent";
import { agentTitleSchema, buildAgentTitlePrompt } from "../analysis/analysis";
import { log } from "../logger";
import type { AppDatabase } from "../db/db";
import type {
  Agent,
  AgentKind,
  AgentStep,
  SessionEvents,
  AgentQuestionRequest,
  AgentQuestionSelection,
  AgentToolApprovalRequest,
  AgentToolApprovalResponse,
} from "../types";
import type { AgentExternalToolSet } from "./external-tools";
import { extractSessionLearnings } from "./learn";

type TypedEmitter = EventEmitter & {
  emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean;
};

type AgentManagerDeps = {
  model: Parameters<typeof runAgent>[1]["model"];
  utilitiesModel: Parameters<typeof runAgent>[1]["model"];
  exaApiKey: string;
  events: TypedEmitter;
  getTranscriptContext: () => string;
  getProjectInstructions?: () => string | undefined;
  getProjectId?: () => string | undefined;
  dataDir?: string;
  getAgentsMd: () => string;
  getProjectAgentsMd?: () => string | null;
  searchTranscriptHistory?: (query: string, limit?: number) => unknown[];
  searchAgentHistory?: (query: string, limit?: number) => unknown[];
  getExternalTools?: () => Promise<AgentExternalToolSet>;
  allowAutoApprove: boolean;
  db?: AppDatabase;
};

export type AgentManager = {
  launchAgent: (kind: AgentKind, todoId: string | undefined, task: string, sessionId?: string, taskContext?: string) => Agent;
  relaunchAgent: (agentId: string) => Agent | null;
  archiveAgent: (agentId: string) => boolean;
  followUpAgent: (agentId: string, question: string) => boolean;
  answerAgentQuestion: (agentId: string, answers: AgentQuestionSelection[]) => { ok: boolean; error?: string };
  answerAgentToolApproval: (agentId: string, response: AgentToolApprovalResponse) => { ok: boolean; error?: string };
  cancelAgent: (id: string) => boolean;
  hydrateAgents: (items: Agent[]) => void;
  getAgent: (id: string) => Agent | undefined;
  getAllAgents: () => Agent[];
  getAgentsForSession: (sessionId: string) => Agent[];
};

const STEP_FLUSH_INTERVAL_MS = 2000;

async function generateAgentTitle(
  agent: Agent,
  deps: AgentManagerDeps,
  agents: Map<string, Agent>,
): Promise<void> {
  try {
    const { object } = await generateObject({
      model: deps.utilitiesModel,
      schema: agentTitleSchema,
      prompt: buildAgentTitlePrompt(agent.task),
      abortSignal: AbortSignal.timeout(15_000),
    });
    const current = agents.get(agent.id);
    if (!current) return;
    current.task = object.title;
    deps.db?.updateAgentTask(agent.id, object.title);
    deps.events.emit("agent-title-generated", agent.id, object.title);
    log("INFO", `Agent title generated for ${agent.id}: "${object.title}"`);
  } catch (err) {
    log("WARN", `Failed to generate agent title for ${agent.id}: ${err}`);
  }
}

export function createAgentManager(deps: AgentManagerDeps): AgentManager {
  const agents = new Map<string, Agent>();
  const abortControllers = new Map<string, AbortController>();
  const conversationHistory = new Map<string, ModelMessage[]>();
  const pendingFlush = new Map<string, NodeJS.Timeout>();
  const pendingQuestions = new Map<string, {
    toolCallId: string;
    request: AgentQuestionRequest;
    resolve: (answers: AgentQuestionSelection[]) => void;
    reject: (error: Error) => void;
  }>();
  const pendingApprovals = new Map<string, {
    toolCallId: string;
    request: AgentToolApprovalRequest;
    resolve: (response: AgentToolApprovalResponse) => void;
    reject: (error: Error) => void;
  }>();

  function buildHistoryFromSteps(agent: Agent): ModelMessage[] {
    const history: ModelMessage[] = [];
    if (agent.task.trim()) {
      const taskPrompt = buildAgentInitialUserPrompt(agent.task, agent.taskContext);
      history.push({ role: "user", content: taskPrompt });
    }

    for (const step of agent.steps) {
      if (!step.content.trim()) continue;
      if (step.kind === "user") {
        history.push({ role: "user", content: step.content });
      }
      if (step.kind === "text") {
        history.push({ role: "assistant", content: step.content });
      }
    }

    return history;
  }

  // Lazy-import exa-js to avoid blocking module load if the package has resolution issues
  let exaInstance: InstanceType<typeof import("exa-js").default> | null = null;
  function getExa() {
    if (!exaInstance) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Exa = require("exa-js").default ?? require("exa-js");
      exaInstance = new Exa(deps.exaApiKey);
    }
    return exaInstance;
  }

  function flushSteps(agentId: string) {
    const agent = agents.get(agentId);
    if (!agent || !deps.db) return;
    deps.db.updateAgent(agentId, { steps: agent.steps });
  }

  function scheduleStepFlush(agentId: string) {
    if (!deps.db) return;
    if (pendingFlush.has(agentId)) return;
    const timer = setTimeout(() => {
      pendingFlush.delete(agentId);
      flushSteps(agentId);
    }, STEP_FLUSH_INTERVAL_MS);
    pendingFlush.set(agentId, timer);
  }

  function cancelFlush(agentId: string) {
    const timer = pendingFlush.get(agentId);
    if (timer) {
      clearTimeout(timer);
      pendingFlush.delete(agentId);
    }
  }

  function rejectPendingQuestion(agentId: string, reason: string) {
    const pending = pendingQuestions.get(agentId);
    if (!pending) return;
    pendingQuestions.delete(agentId);
    pending.reject(new Error(reason));
  }

  function rejectPendingApproval(agentId: string, reason: string) {
    const pending = pendingApprovals.get(agentId);
    if (!pending) return;
    pendingApprovals.delete(agentId);
    pending.reject(new Error(reason));
  }

  function requestClarification(
    agentId: string,
    request: AgentQuestionRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ): Promise<AgentQuestionSelection[]> {
    const { toolCallId, abortSignal } = options;
    rejectPendingQuestion(agentId, "Clarification request replaced by a newer request.");

    return new Promise<AgentQuestionSelection[]>((resolve, reject) => {
      const onAbort = () => {
        pendingQuestions.delete(agentId);
        reject(new Error("Cancelled"));
      };

      if (abortSignal?.aborted) {
        onAbort();
        return;
      }

      if (abortSignal) {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      pendingQuestions.set(agentId, {
        toolCallId,
        request,
        resolve: (answers) => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          pendingQuestions.delete(agentId);
          resolve(answers);
        },
        reject: (error) => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          pendingQuestions.delete(agentId);
          reject(error);
        },
      });
    });
  }

  function requestToolApproval(
    agentId: string,
    request: AgentToolApprovalRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ): Promise<AgentToolApprovalResponse> {
    const { toolCallId, abortSignal } = options;
    rejectPendingApproval(agentId, "Approval request replaced by a newer request.");

    return new Promise<AgentToolApprovalResponse>((resolve, reject) => {
      const onAbort = () => {
        pendingApprovals.delete(agentId);
        reject(new Error("Cancelled"));
      };

      if (abortSignal?.aborted) {
        onAbort();
        return;
      }

      if (abortSignal) {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      pendingApprovals.set(agentId, {
        toolCallId,
        request,
        resolve: (response) => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          pendingApprovals.delete(agentId);
          resolve(response);
        },
        reject: (error) => {
          if (abortSignal) {
            abortSignal.removeEventListener("abort", onAbort);
          }
          pendingApprovals.delete(agentId);
          reject(error);
        },
      });
    });
  }

  function validateQuestionAnswers(
    request: AgentQuestionRequest,
    answers: AgentQuestionSelection[],
  ): string | null {
    if (!Array.isArray(answers) || answers.length === 0) {
      return "At least one answer is required";
    }

    const byQuestionId = new Map<string, AgentQuestionSelection>();
    for (const answer of answers) {
      const questionId = answer.questionId?.trim();
      if (!questionId) return "Each answer must include a questionId";
      if (!Array.isArray(answer.selectedOptionIds)) {
        return `Missing selected options for question ${questionId}`;
      }
      byQuestionId.set(questionId, answer);
    }

    for (const question of request.questions) {
      const answer = byQuestionId.get(question.id);
      if (!answer) {
        return `Missing answer for question ${question.id}`;
      }
      const selected = answer.selectedOptionIds
        .map((id) => id.trim())
        .filter(Boolean);
      if (selected.length === 0) {
        return `Select at least one option for question ${question.id}`;
      }
      if (!question.allow_multiple && selected.length > 1) {
        return `Question ${question.id} allows only one option`;
      }
      const validOptions = new Set(question.options.map((opt) => opt.id));
      for (const selectedId of selected) {
        if (!validOptions.has(selectedId)) {
          return `Invalid option ${selectedId} for question ${question.id}`;
        }
      }
    }

    return null;
  }

  function makeAgentCallbacks(agent: Agent) {
    return {
      onStep: (step: AgentStep) => {
        const existingIdx = agent.steps.findIndex((s) => s.id === step.id);
        if (existingIdx >= 0) {
          agent.steps[existingIdx] = step;
        } else {
          agent.steps.push(step);
        }
        deps.events.emit("agent-step", agent.id, step);
        scheduleStepFlush(agent.id);
      },
      onComplete: (result: string, messages: ModelMessage[]) => {
        agent.status = "completed" as const;
        agent.result = result;
        agent.completedAt = Date.now();
        rejectPendingQuestion(agent.id, "Agent finished before clarification could be answered.");
        rejectPendingApproval(agent.id, "Agent finished before tool approval could be answered.");
        conversationHistory.set(agent.id, messages);
        abortControllers.delete(agent.id);
        cancelFlush(agent.id);
        deps.db?.updateAgent(agent.id, { status: "completed", result, steps: agent.steps, completedAt: agent.completedAt });
        deps.events.emit("agent-completed", agent.id, result);
        log("INFO", `Agent completed: ${agent.id}`);
        if (deps.db) {
          try {
            deps.db.indexAgentFts(agent.id, agent.task, result, agent.taskContext ?? null);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log("WARN", `Agent FTS indexing failed for ${agent.id}: ${message}`);
          }
          if (agent.sessionId) {
            const projectId = deps.getProjectId?.();
            void extractSessionLearnings(deps.model, deps.db, agent.sessionId, projectId, deps.dataDir)
              .catch((err) => log("WARN", `Learning extraction error: ${err}`));
          }
        }
      },
      onFail: (error: string) => {
        agent.status = "failed" as const;
        agent.result = error;
        agent.completedAt = Date.now();
        rejectPendingQuestion(agent.id, error || "Agent failed before clarification could be answered.");
        rejectPendingApproval(agent.id, error || "Agent failed before tool approval could be answered.");
        abortControllers.delete(agent.id);
        cancelFlush(agent.id);
        deps.db?.updateAgent(agent.id, { status: "failed", result: error, steps: agent.steps, completedAt: agent.completedAt });
        deps.events.emit("agent-failed", agent.id, error);
        log("ERROR", `Agent failed: ${agent.id} — ${error}`);
      },
    };
  }

  function launchAgent(
    kind: AgentKind,
    todoId: string | undefined,
    task: string,
    sessionId?: string,
    taskContext?: string,
  ): Agent {
    const agent: Agent = {
      id: crypto.randomUUID(),
      kind,
      todoId,
      task,
      taskContext,
      status: "running",
      steps: [],
      createdAt: Date.now(),
      sessionId,
    };

    agents.set(agent.id, agent);
    deps.db?.insertAgent(agent);
    deps.events.emit("agent-started", agent);
    log("INFO", `Agent launched: ${agent.id} (${kind})${todoId ? ` for todo ${todoId}` : ""}`);

    if (kind === "custom") {
      void generateAgentTitle(agent, deps, agents);
    }

    let exa: ReturnType<typeof getExa>;
    try {
      exa = getExa();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      agent.status = "failed";
      agent.result = `Failed to load Exa SDK: ${msg}`;
      agent.completedAt = Date.now();
      deps.db?.updateAgent(agent.id, { status: agent.status, result: agent.result, completedAt: agent.completedAt });
      deps.events.emit("agent-failed", agent.id, agent.result);
      log("ERROR", `Exa SDK load failed: ${msg}`);
      return agent;
    }

    const controller = new AbortController();
    abortControllers.set(agent.id, controller);

    const callbacks = makeAgentCallbacks(agent);

    void (async () => {
      const agentsMd = deps.getProjectAgentsMd?.() ?? deps.getAgentsMd();

      await runAgent(agent, {
        model: deps.model,
        exa,
        getTranscriptContext: deps.getTranscriptContext,
        projectInstructions: deps.getProjectInstructions?.(),
        agentsMd: agentsMd || undefined,
        searchTranscriptHistory: deps.searchTranscriptHistory,
        searchAgentHistory: deps.searchAgentHistory,
        getExternalTools: deps.getExternalTools,
        allowAutoApprove: deps.allowAutoApprove,
        requestClarification: (request, options) =>
          requestClarification(agent.id, request, options),
        requestToolApproval: (request, options) =>
          requestToolApproval(agent.id, request, options),
        abortSignal: controller.signal,
        ...callbacks,
      });
    })();

    return agent;
  }

  function followUpAgent(agentId: string, question: string): boolean {
    const agent = agents.get(agentId);
    if (!agent) return false;
    if (agent.status === "running") return false;

    const history = conversationHistory.get(agentId);
    if (!history || history.length === 0) return false;

    let exa: ReturnType<typeof getExa>;
    try {
      exa = getExa();
    } catch {
      return false;
    }

    // Add the user's follow-up as a visible step
    const followUpStep: AgentStep = {
      id: crypto.randomUUID(),
      kind: "user",
      content: question,
      createdAt: Date.now(),
    };
    agent.steps.push(followUpStep);

    // Reset agent to running state
    agent.status = "running";
    agent.result = undefined;
    agent.completedAt = undefined;
    deps.db?.updateAgent(agentId, { status: "running", result: undefined, completedAt: undefined, steps: agent.steps });
    deps.events.emit("agent-started", agent);

    const controller = new AbortController();
    abortControllers.set(agentId, controller);

    const callbacks = makeAgentCallbacks(agent);

    void (async () => {
      const agentsMd = deps.getProjectAgentsMd?.() ?? deps.getAgentsMd();

      await continueAgent(agent, history, question, {
        model: deps.model,
        exa,
        getTranscriptContext: deps.getTranscriptContext,
        projectInstructions: deps.getProjectInstructions?.(),
        agentsMd: agentsMd || undefined,
        searchTranscriptHistory: deps.searchTranscriptHistory,
        searchAgentHistory: deps.searchAgentHistory,
        getExternalTools: deps.getExternalTools,
        allowAutoApprove: deps.allowAutoApprove,
        requestClarification: (request, options) =>
          requestClarification(agent.id, request, options),
        requestToolApproval: (request, options) =>
          requestToolApproval(agent.id, request, options),
        abortSignal: controller.signal,
        ...callbacks,
      });
    })();

    log("INFO", `Agent follow-up: ${agentId}`);
    return true;
  }

  function hydrateAgents(items: Agent[]) {
    for (const item of items) {
      // Copy arrays to avoid accidental shared mutation with renderer snapshots.
      const agent: Agent = {
        ...item,
        steps: [...item.steps],
      };
      agents.set(agent.id, agent);
      const history = buildHistoryFromSteps(agent);
      if (history.length > 0) {
        conversationHistory.set(agent.id, history);
      }
    }
    if (items.length > 0) {
      log("INFO", `Hydrated ${items.length} agent(s) from database`);
    }
  }

  function answerAgentQuestion(
    agentId: string,
    answers: AgentQuestionSelection[],
  ): { ok: boolean; error?: string } {
    const pending = pendingQuestions.get(agentId);
    if (!pending) {
      return { ok: false, error: "No pending question for this agent" };
    }

    const validationError = validateQuestionAnswers(pending.request, answers);
    if (validationError) {
      return { ok: false, error: validationError };
    }

    const normalizedAnswers: AgentQuestionSelection[] = pending.request.questions.map((question) => {
      const answer = answers.find((item) => item.questionId === question.id);
      const selectedOptionIds = Array.from(new Set((answer?.selectedOptionIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean)));
      return {
        questionId: question.id,
        selectedOptionIds,
      };
    });

    pending.resolve(normalizedAnswers);
    return { ok: true };
  }

  function answerAgentToolApproval(
    agentId: string,
    response: AgentToolApprovalResponse,
  ): { ok: boolean; error?: string } {
    const pending = pendingApprovals.get(agentId);
    if (!pending) {
      return { ok: false, error: "No pending tool approval for this agent" };
    }

    if (response.approvalId !== pending.request.id) {
      return { ok: false, error: "Approval id does not match pending request" };
    }

    pending.resolve({
      approvalId: pending.request.id,
      approved: response.approved === true,
    });
    return { ok: true };
  }

  function archiveAgent(agentId: string): boolean {
    const agent = agents.get(agentId);
    if (!agent || agent.status === "running") return false;
    agents.delete(agentId);
    conversationHistory.delete(agentId);
    cancelFlush(agentId);
    deps.db?.archiveAgent(agentId);
    deps.events.emit("agent-archived", agentId);
    log("INFO", `Agent archived: ${agentId}`);
    return true;
  }

  function cancelAgent(id: string): boolean {
    const controller = abortControllers.get(id);
    if (!controller) return false;
    controller.abort();
    rejectPendingApproval(id, "Cancelled");
    rejectPendingQuestion(id, "Cancelled");
    return true;
  }

  function relaunchAgent(agentId: string): Agent | null {
    const agent = agents.get(agentId);
    if (!agent) return null;
    if (agent.status === "running") return null;

    // Tear down any stale state from the previous run
    abortControllers.get(agentId)?.abort();
    abortControllers.delete(agentId);
    rejectPendingQuestion(agentId, "Agent relaunched");
    rejectPendingApproval(agentId, "Agent relaunched");
    cancelFlush(agentId);
    conversationHistory.delete(agentId);

    // Reset the agent in-place so the same object/ID is reused
    agent.status = "running";
    agent.steps = [];
    agent.result = undefined;
    agent.completedAt = undefined;
    agent.createdAt = Date.now();
    // Refresh task context so the agent starts with current transcript, not the
    // stale snapshot captured when the todo was originally created.
    agent.taskContext = deps.getTranscriptContext();

    deps.db?.updateAgent(agentId, { status: "running", steps: [], result: undefined, completedAt: undefined });
    deps.events.emit("agent-started", agent);
    log("INFO", `Agent relaunched: ${agentId}`);

    let exa: ReturnType<typeof getExa>;
    try {
      exa = getExa();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      agent.status = "failed";
      agent.result = `Failed to load Exa SDK: ${msg}`;
      agent.completedAt = Date.now();
      deps.db?.updateAgent(agentId, { status: agent.status, result: agent.result, completedAt: agent.completedAt });
      deps.events.emit("agent-failed", agentId, agent.result);
      return agent;
    }

    const controller = new AbortController();
    abortControllers.set(agentId, controller);

    void (async () => {
      const agentsMd = deps.getProjectAgentsMd?.() ?? deps.getAgentsMd();

      await runAgent(agent, {
        model: deps.model,
        exa,
        getTranscriptContext: deps.getTranscriptContext,
        projectInstructions: deps.getProjectInstructions?.(),
        agentsMd: agentsMd || undefined,
        searchTranscriptHistory: deps.searchTranscriptHistory,
        searchAgentHistory: deps.searchAgentHistory,
        getExternalTools: deps.getExternalTools,
        allowAutoApprove: deps.allowAutoApprove,
        requestClarification: (request, options) => requestClarification(agentId, request, options),
        requestToolApproval: (request, options) => requestToolApproval(agentId, request, options),
        abortSignal: controller.signal,
        ...makeAgentCallbacks(agent),
      });
    })();

    return agent;
  }

  return {
    launchAgent,
    relaunchAgent,
    archiveAgent,
    followUpAgent,
    answerAgentQuestion,
    answerAgentToolApproval,
    cancelAgent,
    hydrateAgents,
    getAgent: (id) => agents.get(id),
    getAllAgents: () => [...agents.values()],
    getAgentsForSession: (sessionId) => {
      return deps.db?.getAgentsForSession(sessionId) ?? [];
    },
  };
}
