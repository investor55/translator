import { EventEmitter } from "node:events";
import { runAgent } from "./agent";
import { log } from "./logger";
import type { Agent, AgentStep, SessionEvents } from "./types";

type TypedEmitter = EventEmitter & {
  emit<K extends keyof SessionEvents>(event: K, ...args: SessionEvents[K]): boolean;
};

type AgentManagerDeps = {
  model: Parameters<typeof runAgent>[1]["model"];
  exaApiKey: string;
  events: TypedEmitter;
  getTranscriptContext: () => string;
};

export type AgentManager = {
  launchAgent: (todoId: string, task: string, sessionId?: string) => Agent;
  getAgent: (id: string) => Agent | undefined;
  getAllAgents: () => Agent[];
};

export function createAgentManager(deps: AgentManagerDeps): AgentManager {
  const agents = new Map<string, Agent>();

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
      deps.events.emit("agent-failed", agent.id, agent.result);
      log("ERROR", `Exa SDK load failed: ${msg}`);
      return agent;
    }

    void runAgent(agent, {
      model: deps.model,
      exa,
      getTranscriptContext: deps.getTranscriptContext,
      onStep: (step: AgentStep) => {
        agent.steps.push(step);
        deps.events.emit("agent-step", agent.id, step);
      },
      onComplete: (result: string) => {
        agent.status = "completed";
        agent.result = result;
        agent.completedAt = Date.now();
        deps.events.emit("agent-completed", agent.id, result);
        log("INFO", `Agent completed: ${agent.id}`);
      },
      onFail: (error: string) => {
        agent.status = "failed";
        agent.result = error;
        agent.completedAt = Date.now();
        deps.events.emit("agent-failed", agent.id, error);
        log("ERROR", `Agent failed: ${agent.id} — ${error}`);
      },
    });

    return agent;
  }

  return {
    launchAgent,
    getAgent: (id) => agents.get(id),
    getAllAgents: () => [...agents.values()],
  };
}
