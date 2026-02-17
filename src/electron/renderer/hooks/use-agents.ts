import { useEffect, useReducer, useCallback } from "react";
import type { Agent, AgentStep } from "../../../core/types";

type AgentsState = {
  agents: Agent[];
  selectedAgentId: string | null;
};

type AgentsAction =
  | { kind: "agent-started"; agent: Agent }
  | { kind: "agent-step"; agentId: string; step: AgentStep }
  | { kind: "agent-completed"; agentId: string; result: string }
  | { kind: "agent-failed"; agentId: string; error: string }
  | { kind: "select-agent"; agentId: string | null }
  | { kind: "reset" };

function agentsReducer(state: AgentsState, action: AgentsAction): AgentsState {
  switch (action.kind) {
    case "agent-started":
      return { ...state, agents: [action.agent, ...state.agents] };
    case "agent-step":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.agentId
            ? { ...a, steps: [...a.steps, action.step] }
            : a
        ),
      };
    case "agent-completed":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.agentId
            ? { ...a, status: "completed" as const, result: action.result, completedAt: Date.now() }
            : a
        ),
      };
    case "agent-failed":
      return {
        ...state,
        agents: state.agents.map((a) =>
          a.id === action.agentId
            ? { ...a, status: "failed" as const, result: action.error, completedAt: Date.now() }
            : a
        ),
      };
    case "select-agent":
      return { ...state, selectedAgentId: action.agentId };
    case "reset":
      return { agents: [], selectedAgentId: null };
  }
}

const initialState: AgentsState = { agents: [], selectedAgentId: null };

export function useAgents(sessionActive: boolean) {
  const [state, dispatch] = useReducer(agentsReducer, initialState);

  useEffect(() => {
    if (!sessionActive) {
      dispatch({ kind: "reset" });
      return;
    }

    const api = window.electronAPI;
    const cleanups = [
      api.onAgentStarted((agent) => dispatch({ kind: "agent-started", agent })),
      api.onAgentStep((agentId, step) => dispatch({ kind: "agent-step", agentId, step })),
      api.onAgentCompleted((agentId, result) => dispatch({ kind: "agent-completed", agentId, result })),
      api.onAgentFailed((agentId, error) => dispatch({ kind: "agent-failed", agentId, error })),
    ];

    return () => cleanups.forEach((fn) => fn());
  }, [sessionActive]);

  const selectAgent = useCallback((agentId: string | null) => {
    dispatch({ kind: "select-agent", agentId });
  }, []);

  const selectedAgent = state.selectedAgentId
    ? state.agents.find((a) => a.id === state.selectedAgentId) ?? null
    : null;

  return {
    agents: state.agents,
    selectedAgentId: state.selectedAgentId,
    selectedAgent,
    selectAgent,
  };
}
