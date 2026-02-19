import type { Agent } from "../../../core/types";
import { HugeiconsIcon } from "@hugeicons/react";
import { WorkoutRunIcon } from "@hugeicons/core-free-icons";
import { PlusIcon } from "lucide-react";
import { SectionLabel } from "@/components/ui/section-label";

type AgentListProps = {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onNewAgent?: () => void;
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
      return <HugeiconsIcon icon={WorkoutRunIcon} className="size-3.5 text-primary animate-pulse shrink-0" />;
    case "completed":
      return <HugeiconsIcon icon={WorkoutRunIcon} className="size-3.5 text-green-500 shrink-0" />;
    case "failed":
      return <HugeiconsIcon icon={WorkoutRunIcon} className="size-3.5 text-destructive shrink-0" />;
  }
}

export function AgentList({
  agents,
  selectedAgentId,
  onSelectAgent,
  onNewAgent,
}: AgentListProps) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between">
        <SectionLabel as="span">Agents{agents.length > 0 ? ` (${agents.length})` : ""}</SectionLabel>
        {onNewAgent && (
          <button
            type="button"
            onClick={onNewAgent}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="New agent"
          >
            <PlusIcon className="size-3" />
          </button>
        )}
      </div>

      {agents.length > 0 && (
        <ul className="mt-1">
          {agents.map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                onClick={() => onSelectAgent(agent.id)}
                className={`w-full text-left rounded-sm px-2 py-1 transition-colors ${
                  selectedAgentId === agent.id
                    ? "bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-muted/50 border-l-2 border-l-transparent"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <StatusIcon status={agent.status} />
                  <p className="text-xs text-foreground truncate flex-1">
                    {agent.task}
                  </p>
                  <span className="text-2xs text-muted-foreground shrink-0 font-mono">
                    {relativeTime(agent.completedAt ?? agent.createdAt)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
