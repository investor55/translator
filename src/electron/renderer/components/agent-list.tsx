import type { Agent } from "../../../core/types";
import { LoaderCircleIcon, CheckCircleIcon, XCircleIcon } from "lucide-react";

type AgentListProps = {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
};

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function StatusIcon({ status }: { status: Agent["status"] }) {
  switch (status) {
    case "running":
      return <LoaderCircleIcon className="size-3.5 text-primary animate-spin shrink-0" />;
    case "completed":
      return <CheckCircleIcon className="size-3.5 text-green-500 shrink-0" />;
    case "failed":
      return <XCircleIcon className="size-3.5 text-destructive shrink-0" />;
  }
}

function lastStepSummary(agent: Agent): string {
  if (agent.steps.length === 0) return "Starting...";
  const last = agent.steps[agent.steps.length - 1];
  switch (last.kind) {
    case "thinking":
      return "Thinking...";
    case "tool-call":
      return `Searching: ${last.content.slice(0, 40)}`;
    case "tool-result":
      return "Processing results...";
    case "text":
      return last.content.slice(0, 60);
  }
}

export function AgentList({ agents, selectedAgentId, onSelectAgent }: AgentListProps) {
  if (agents.length === 0) return null;

  return (
    <div className="mb-3">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        Agents
      </span>
      <ul className="mt-1.5 space-y-1">
        {agents.map((agent) => (
          <li key={agent.id}>
            <button
              type="button"
              onClick={() => onSelectAgent(agent.id)}
              className={`w-full text-left rounded-md px-2 py-1.5 transition-colors ${
                selectedAgentId === agent.id
                  ? "bg-primary/10 border border-primary/20"
                  : "hover:bg-muted/50 border border-transparent"
              }`}
            >
              <div className="flex items-start gap-2">
                <StatusIcon status={agent.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground leading-relaxed line-clamp-2">
                    {agent.task}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {agent.status === "running"
                      ? lastStepSummary(agent)
                      : relativeTime(agent.completedAt ?? agent.createdAt)}
                  </p>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
