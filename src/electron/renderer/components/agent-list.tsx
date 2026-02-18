import type { Agent } from "../../../core/types";
import { LoaderCircleIcon, CheckCircleIcon, XCircleIcon, SparklesIcon } from "lucide-react";

type AgentListProps = {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onGenerateDebrief?: () => void;
  canGenerateDebrief?: boolean;
  isDebriefLoading?: boolean;
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
  const lastVisible = [...agent.steps]
    .reverse()
    .find(
      (step) =>
        step.kind === "user" ||
        step.kind === "text" ||
        step.kind === "tool-call" ||
        step.kind === "thinking"
    );

  if (!lastVisible) {
    return agent.status === "running" ? "Researching..." : "No messages yet";
  }

  if (lastVisible.kind === "user") {
    return `You: ${lastVisible.content.slice(0, 52)}`;
  }
  if (lastVisible.kind === "thinking") {
    return "Thinking...";
  }

  return lastVisible.content.slice(0, 60);
}

function contextPreview(agent: Agent): string | null {
  const contextText = agent.taskContext?.trim();
  if (!contextText) return null;
  return contextText.replace(/\s+/g, " ").slice(0, 140);
}

export function AgentList({
  agents,
  selectedAgentId,
  onSelectAgent,
  onGenerateDebrief,
  canGenerateDebrief,
  isDebriefLoading,
}: AgentListProps) {
  if (agents.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Agents ({agents.length})
        </span>
        {onGenerateDebrief && (
          <button
            type="button"
            onClick={onGenerateDebrief}
            disabled={!canGenerateDebrief || isDebriefLoading}
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Generate agent debrief"
            title={canGenerateDebrief ? "Generate debrief" : "Wait for all agents to finish"}
          >
            <SparklesIcon className="size-3" />
            Debrief
          </button>
        )}
      </div>
      <ul className="mt-1.5 space-y-1">
        {agents.map((agent) => {
          const preview = contextPreview(agent);
          return (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => onSelectAgent(agent.id)}
                className={`w-full text-left rounded-none px-2 py-1.5 transition-colors ${
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
                    {preview && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                        Context: {preview}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate font-mono">
                      {agent.status === "running"
                        ? lastStepSummary(agent)
                        : relativeTime(agent.completedAt ?? agent.createdAt)}
                    </p>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
