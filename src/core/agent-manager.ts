import { EventEmitter } from "node:events";
import type { ModelMessage } from "ai";
import { runAgent, continueAgent } from "./agent";
import { log } from "./logger";
import type { AppDatabase } from "./db";
import type { Agent, AgentStep, SessionEvents } from "./types";

type TypedEmitter = EventEmitter & {
  emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean;
};

type AgentManagerDeps = {
  model: Parameters<typeof runAgent>[1]["model"];
  exaApiKey: string;
  events: TypedEmitter;
  getTranscriptContext: () => string;
  db?: AppDatabase;
};

export type AgentManager = {
  launchAgent: (todoId: string, task: string, sessionId?: string) => Agent;
  followUpAgent: (agentId: string, question: string) => boolean;
  cancelAgent: (id: string) => boolean;
  getAgent: (id: string) => Agent | undefined;
  getAllAgents: () => Agent[];
  getAgentsForSession: (sessionId: string) => Agent[];
};

const STEP_FLUSH_INTERVAL_MS = 2000;

export function createAgentManager(deps: AgentManagerDeps): AgentManager {
  const agents = new Map<string, Agent>();
  const abortControllers = new Map<string, AbortController>();
  const conversationHistory = new Map<string, ModelMessage[]>();
  const pendingFlush = new Map<string, NodeJS.Timeout>();

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

  function makeAgentCallbacks(agent: Agent) {
    return {
      onStep: (step: AgentStep) => {
        agent.steps.push(step);
        deps.events.emit("agent-step", agent.id, step);
        scheduleStepFlush(agent.id);
      },
      onComplete: (result: string, messages: ModelMessage[]) => {
        agent.status = "completed" as const;
        agent.result = result;
        agent.completedAt = Date.now();
        conversationHistory.set(agent.id, messages);
        abortControllers.delete(agent.id);
        cancelFlush(agent.id);
        deps.db?.updateAgent(agent.id, { status: "completed", result, steps: agent.steps, completedAt: agent.completedAt });
        deps.events.emit("agent-completed", agent.id, result);
        log("INFO", `Agent completed: ${agent.id}`);
      },
      onFail: (error: string) => {
        agent.status = "failed" as const;
        agent.result = error;
        agent.completedAt = Date.now();
        abortControllers.delete(agent.id);
        cancelFlush(agent.id);
        deps.db?.updateAgent(agent.id, { status: "failed", result: error, steps: agent.steps, completedAt: agent.completedAt });
        deps.events.emit("agent-failed", agent.id, error);
        log("ERROR", `Agent failed: ${agent.id} — ${error}`);
      },
    };
  }

  function launchAgent(todoId: string, task: string, sessionId?: string): Agent {
    const agent: Agent = {
      id: crypto.randomUUID(),
      todoId,
      task,
      status: "running",
      steps: [],
      createdAt: Date.now(),
      sessionId,
    };

    agents.set(agent.id, agent);
    deps.db?.insertAgent(agent);
    deps.events.emit("agent-started", agent);
    log("INFO", `Agent launched: ${agent.id} for todo ${todoId}`);

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

    void runAgent(agent, {
      model: deps.model,
      exa,
      getTranscriptContext: deps.getTranscriptContext,
      abortSignal: controller.signal,
      ...callbacks,
    });

    return agent;
  }

  function followUpAgent(agentId: string, question: string): boolean {
    const agent = agents.get(agentId);
    if (!agent) return false;
    if (agent.status === "running") return false;

    const history = conversationHistory.get(agentId);
    if (!history) return false;

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

    void continueAgent(agent, history, question, {
      model: deps.model,
      exa,
      getTranscriptContext: deps.getTranscriptContext,
      abortSignal: controller.signal,
      ...callbacks,
    });

    log("INFO", `Agent follow-up: ${agentId}`);
    return true;
  }

  function cancelAgent(id: string): boolean {
    const controller = abortControllers.get(id);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  return {
    launchAgent,
    followUpAgent,
    cancelAgent,
    getAgent: (id) => agents.get(id),
    getAllAgents: () => [...agents.values()],
    getAgentsForSession: (sessionId) => {
      return deps.db?.getAgentsForSession(sessionId) ?? [];
    },
  };
}
