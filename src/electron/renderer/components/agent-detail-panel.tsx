import { useEffect, useRef, useCallback } from "react";
import {
  XIcon,
  SearchIcon,
  LoaderCircleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SquareIcon,
} from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import type { Agent, AgentStep } from "../../../core/types";

type AgentDetailPanelProps = {
  agent: Agent;
  agents: Agent[];
  onSelectAgent: (id: string) => void;
  onClose: () => void;
  onFollowUp?: (agent: Agent, question: string) => void;
  onCancel?: (agentId: string) => void;
};

function StatusBadge({ status }: { status: Agent["status"] }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
          <LoaderCircleIcon className="size-3 animate-spin" />
          Running
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded-full">
          <CheckCircleIcon className="size-3" />
          Done
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive bg-destructive/10 px-1.5 py-0.5 rounded-full">
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
          <div className="inline-flex items-center gap-1.5 rounded-none border border-border bg-muted/50 px-2.5 py-1">
            <SearchIcon className="size-3 text-muted-foreground" />
            <span className="text-xs text-foreground">{step.content}</span>
          </div>
        </div>
      );
    case "tool-result":
      return null;
    case "text":
      return (
        <div className="py-2 border-t border-border mt-1">
          <div className="text-xs text-foreground leading-relaxed [&_a]:text-primary [&_a]:underline">
            <MessageResponse>{step.content}</MessageResponse>
          </div>
        </div>
      );
    case "user":
      return (
        <div className="py-2 border-t border-border mt-2">
          <p className="text-xs text-muted-foreground font-medium mb-0.5">You</p>
          <p className="text-xs text-foreground leading-relaxed">{step.content}</p>
        </div>
      );
  }
}

export function AgentDetailPanel({
  agent,
  agents,
  onSelectAgent,
  onClose,
  onFollowUp,
  onCancel,
}: AgentDetailPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent.steps.length]);

  const currentIndex = agents.findIndex((a) => a.id === agent.id);
  const hasPrev = currentIndex < agents.length - 1;
  const hasNext = currentIndex > 0;
  const isRunning = agent.status === "running";

  const handleFollowUpSubmit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text || !onFollowUp) return;
      onFollowUp(agent, text);
    },
    [agent, onFollowUp]
  );

  const handleCancel = useCallback(() => {
    onCancel?.(agent.id);
  }, [agent.id, onCancel]);

  return (
    <div className="w-[360px] shrink-0 border-l border-border flex flex-col min-h-0 bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <StatusBadge status={agent.status} />
        <span className="text-xs font-medium text-foreground truncate flex-1 min-w-0">
          {agent.task}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {isRunning && onCancel && (
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center gap-1 rounded-none px-1.5 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors"
              aria-label="Cancel agent"
            >
              <SquareIcon className="size-3" />
              Stop
            </button>
          )}
          {agents.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => hasPrev && onSelectAgent(agents[currentIndex + 1].id)}
                disabled={!hasPrev}
                className="rounded-none p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-default transition-colors"
                aria-label="Previous agent"
              >
                <ChevronLeftIcon className="size-3.5" />
              </button>
              <span className="text-[11px] font-mono text-muted-foreground tabular-nums mx-0.5">
                {agents.length - currentIndex}/{agents.length}
              </span>
              <button
                type="button"
                onClick={() => hasNext && onSelectAgent(agents[currentIndex - 1].id)}
                disabled={!hasNext}
                className="rounded-none p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-default transition-colors"
                aria-label="Next agent"
              >
                <ChevronRightIcon className="size-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-none p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ml-1"
            aria-label="Close panel"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Step timeline */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5">
        {agent.steps.length === 0 && isRunning && (
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

      {/* Follow-up input — shown when agent is done */}
      {!isRunning && onFollowUp && (
        <div className="shrink-0 border-t border-border p-2">
          <PromptInput onSubmit={handleFollowUpSubmit}>
            <PromptInputTextarea
              placeholder="Ask a follow-up..."
              className="min-h-8 max-h-24 text-xs"
            />
            <PromptInputFooter>
              <div />
              <PromptInputSubmit />
            </PromptInputFooter>
          </PromptInput>
        </div>
      )}
    </div>
  );
}
