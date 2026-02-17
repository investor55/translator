import { useCallback, useMemo, useState } from "react";
import {
  XIcon,
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
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import type { Agent, AgentStep } from "../../../core/types";

type FollowUpResult = { ok: boolean; error?: string };

type AgentDetailPanelProps = {
  agent: Agent;
  agents: Agent[];
  onSelectAgent: (id: string) => void;
  onClose: () => void;
  onFollowUp?: (agent: Agent, question: string) => Promise<FollowUpResult> | FollowUpResult;
  onCancel?: (agentId: string) => void;
};

function StatusBadge({ status }: { status: Agent["status"] }) {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 rounded-none bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          <LoaderCircleIcon className="size-3 animate-spin" />
          Running
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 rounded-none bg-green-500/10 px-1.5 py-0.5 text-[11px] font-medium text-green-600">
          <CheckCircleIcon className="size-3" />
          Done
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-none bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
          <XCircleIcon className="size-3" />
          Failed
        </span>
      );
  }
}

function StepItem({ step }: { step: AgentStep }) {
  switch (step.kind) {
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
    default:
      return null;
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
  const [followUpError, setFollowUpError] = useState("");
  const visibleSteps = useMemo(
    () => agent.steps.filter((step) => step.kind === "user" || step.kind === "text"),
    [agent.steps]
  );

  const currentIndex = agents.findIndex((a) => a.id === agent.id);
  const hasPrev = currentIndex < agents.length - 1;
  const hasNext = currentIndex > 0;
  const isRunning = agent.status === "running";
  const canFollowUp = !isRunning && !!onFollowUp;

  const handleFollowUpSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text || !onFollowUp) return;
      setFollowUpError("");
      const result = await onFollowUp(agent, text);
      if (!result.ok) {
        const errorText = result.error ?? "Follow-up could not start.";
        setFollowUpError(errorText);
        throw new Error(errorText);
      }
    },
    [agent, onFollowUp]
  );

  const handleCancel = useCallback(() => {
    onCancel?.(agent.id);
  }, [agent.id, onCancel]);

  return (
    <div className="w-[360px] shrink-0 border-l border-border flex flex-col min-h-0 bg-sidebar">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={agent.status} />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {agent.task}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            {isRunning && onCancel && (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex items-center gap-1 rounded-none px-1.5 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
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
                  className="rounded-none p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
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
                  className="rounded-none p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
                  aria-label="Next agent"
                >
                  <ChevronRightIcon className="size-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-1 rounded-none p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close panel"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Step timeline */}
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="px-3 py-2.5">
          {visibleSteps.length === 0 && isRunning && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Starting agent...
            </div>
          )}
          {visibleSteps.length === 0 && !isRunning && (
            <p className="text-xs italic text-muted-foreground">
              No messages yet.
            </p>
          )}
          {visibleSteps.map((step) => (
            <StepItem key={step.id} step={step} />
          ))}
          {isRunning && visibleSteps.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Streaming...
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

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
              <PromptInputSubmit disabled={!canFollowUp} />
            </PromptInputFooter>
          </PromptInput>
          {followUpError && (
            <p className="mt-1.5 text-[11px] text-destructive">
              {followUpError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
