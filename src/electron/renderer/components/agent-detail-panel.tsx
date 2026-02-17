import { useEffect, useRef } from "react";
import {
  XIcon,
  SearchIcon,
  LoaderCircleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import type { Agent, AgentStep } from "../../../core/types";

type AgentDetailPanelProps = {
  agent: Agent;
  agents: Agent[];
  onSelectAgent: (id: string) => void;
  onClose: () => void;
};

function StatusBadge({ status }: { status: Agent["status"] }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
          <LoaderCircleIcon className="size-3 animate-spin" />
          Running
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full">
          <CheckCircleIcon className="size-3" />
          Done
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive bg-destructive/10 px-1.5 py-0.5 rounded-full">
          <XCircleIcon className="size-3" />
          Failed
        </span>
      );
  }
}

function StepItem({ step }: { step: AgentStep }) {
  switch (step.kind) {
    case "thinking":
      return (
        <div className="py-1.5">
          <p className="text-xs text-muted-foreground italic leading-relaxed">
            {step.content}
          </p>
        </div>
      );
    case "tool-call":
      return (
        <div className="py-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1">
            <SearchIcon className="size-3 text-muted-foreground" />
            <span className="text-xs text-foreground">{step.content}</span>
          </div>
        </div>
      );
    case "tool-result":
      return (
        <div className="py-1.5">
          <details className="group">
            <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
              Search results
            </summary>
            <div className="mt-1.5 rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {step.content}
            </div>
          </details>
        </div>
      );
    case "text":
      return (
        <div className="py-2 border-t border-border mt-1">
          <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
            {step.content}
          </p>
        </div>
      );
  }
}

export function AgentDetailPanel({ agent, agents, onSelectAgent, onClose }: AgentDetailPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent.steps.length]);

  const currentIndex = agents.findIndex((a) => a.id === agent.id);
  const hasPrev = currentIndex < agents.length - 1;
  const hasNext = currentIndex > 0;

  return (
    <div className="w-[360px] shrink-0 border-l border-border flex flex-col min-h-0 bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <StatusBadge status={agent.status} />
        <span className="text-xs font-medium text-foreground truncate flex-1 min-w-0">
          {agent.task}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {agents.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => hasPrev && onSelectAgent(agents[currentIndex + 1].id)}
                disabled={!hasPrev}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-default transition-colors"
                aria-label="Previous agent"
              >
                <ChevronLeftIcon className="size-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground tabular-nums mx-0.5">
                {agents.length - currentIndex}/{agents.length}
              </span>
              <button
                type="button"
                onClick={() => hasNext && onSelectAgent(agents[currentIndex - 1].id)}
                disabled={!hasNext}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-default transition-colors"
                aria-label="Next agent"
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ml-1"
            aria-label="Close panel"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Step timeline */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {agent.steps.length === 0 && agent.status === "running" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            Starting agent...
          </div>
        )}
        {agent.steps.map((step) => (
          <StepItem key={step.id} step={step} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
