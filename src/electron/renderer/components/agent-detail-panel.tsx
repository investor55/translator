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
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  type ToolState,
} from "@/components/ai-elements/tool";
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

function StepItem({
  step,
  isRunning,
  isReasoningStreaming,
}: {
  step: AgentStep;
  isRunning: boolean;
  isReasoningStreaming: boolean;
}) {
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
    case "thinking":
      return (
        <div className="py-1 border-t border-border mt-1">
          <Reasoning className="w-full" defaultOpen={false} isStreaming={isReasoningStreaming}>
            <ReasoningTrigger />
            <ReasoningContent>{step.content}</ReasoningContent>
          </Reasoning>
        </div>
      );
    case "tool-call":
    case "tool-result": {
      const state: ToolState =
        step.kind === "tool-call"
          ? isRunning
            ? "input-streaming"
            : "output-available"
          : step.content.toLowerCase().includes("failed")
            ? "output-error"
            : "output-available";
      return (
        <div className="py-0.5 border-t border-border mt-1">
          <Tool defaultOpen={false} isStreaming={state === "input-streaming"}>
            <ToolHeader
              state={state}
              title={step.content}
              type={`tool-${step.toolName ?? "tool"}`}
            />
            {step.toolInput && (
              <ToolContent>
                <ToolInput input={step.toolInput} />
              </ToolContent>
            )}
          </Tool>
        </div>
      );
    }
    default:
      return null;
  }
}

function ToolSummaryItem({ title, steps }: { title: string; steps: AgentStep[] }) {
  return (
    <div className="py-0.5 border-t border-border mt-1">
      <Tool defaultOpen={false} isStreaming={false}>
        <ToolHeader state="output-available" title={title} type="tool-summary" />
        <ToolContent>
          <div className="space-y-1">
            {steps.map((step) => (
              <p
                className="text-[10px] text-muted-foreground/90 leading-snug truncate"
                key={step.id}
                title={step.content}
              >
                {step.content}
              </p>
            ))}
          </div>
        </ToolContent>
      </Tool>
    </div>
  );
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
    () =>
      agent.steps.filter(
        (step) =>
          step.kind === "user" ||
          step.kind === "text" ||
          step.kind === "thinking" ||
          step.kind === "tool-call" ||
          step.kind === "tool-result"
      ),
    [agent.steps]
  );

  const currentIndex = agents.findIndex((a) => a.id === agent.id);
  const hasPrev = currentIndex < agents.length - 1;
  const hasNext = currentIndex > 0;
  const isRunning = agent.status === "running";
  const canFollowUp = !isRunning && !!onFollowUp;
  const activeTurnStartAt = useMemo(() => {
    const lastUserStep = [...agent.steps]
      .reverse()
      .find((step) => step.kind === "user");
    return lastUserStep?.createdAt ?? agent.createdAt;
  }, [agent.createdAt, agent.steps]);
  const hasCurrentTurnText = useMemo(
    () =>
      agent.steps.some(
        (step) => step.kind === "text" && step.createdAt >= activeTurnStartAt
      ),
    [activeTurnStartAt, agent.steps]
  );
  const hasCurrentTurnActivity = useMemo(
    () =>
      agent.steps.some(
        (step) => step.kind !== "user" && step.createdAt >= activeTurnStartAt
      ),
    [activeTurnStartAt, agent.steps]
  );
  const showPlanning = isRunning && !hasCurrentTurnActivity;
  const latestThinkingStepId = useMemo(
    () =>
      [...visibleSteps].reverse().find((step) => step.kind === "thinking")?.id ??
      null,
    [visibleSteps]
  );
  const currentTurnToolSteps = useMemo(
    () =>
      visibleSteps.filter(
        (step) =>
          (step.kind === "tool-call" || step.kind === "tool-result") &&
          step.createdAt >= activeTurnStartAt
      ),
    [activeTurnStartAt, visibleSteps]
  );
  const collapseCurrentTurnTools = hasCurrentTurnText && currentTurnToolSteps.length > 0;
  const collapsedToolStepIds = useMemo(
    () => new Set(currentTurnToolSteps.map((step) => step.id)),
    [currentTurnToolSteps]
  );
  const toolSummaryTitle = useMemo(() => {
    const searchCount = currentTurnToolSteps.filter(
      (step) => step.toolName === "searchWeb"
    ).length;
    if (searchCount > 0) {
      return `Did ${searchCount} search${searchCount === 1 ? "" : "es"}`;
    }
    const total = currentTurnToolSteps.length;
    return `Used ${total} tool${total === 1 ? "" : "s"}`;
  }, [currentTurnToolSteps]);
  const timelineItems = useMemo(() => {
    if (!collapseCurrentTurnTools) {
      return visibleSteps.map((step) => ({ kind: "step" as const, step }));
    }

    const items: Array<
      | { kind: "step"; step: AgentStep }
      | { kind: "tool-summary" }
    > = [];
    let insertedSummary = false;

    for (const step of visibleSteps) {
      if (collapsedToolStepIds.has(step.id)) {
        if (!insertedSummary) {
          items.push({ kind: "tool-summary" });
          insertedSummary = true;
        }
        continue;
      }
      items.push({ kind: "step", step });
    }

    return items;
  }, [collapseCurrentTurnTools, collapsedToolStepIds, visibleSteps]);

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
          {visibleSteps.length === 0 && !isRunning && (
            <p className="text-xs italic text-muted-foreground">
              No messages yet.
            </p>
          )}
          {timelineItems.map((item, index) =>
            item.kind === "tool-summary" ? (
              <ToolSummaryItem
                key={`tool-summary-${agent.id}-${activeTurnStartAt}-${index}`}
                steps={currentTurnToolSteps}
                title={toolSummaryTitle}
              />
            ) : (
              <StepItem
                isReasoningStreaming={
                  isRunning &&
                  !hasCurrentTurnText &&
                  item.step.kind === "thinking" &&
                  item.step.id === latestThinkingStepId
                }
                isRunning={isRunning}
                key={item.step.id}
                step={item.step}
              />
            )
          )}
          {showPlanning && (
            <div className="py-1">
              <Shimmer as="p" className="text-xs text-muted-foreground">
                Planning
              </Shimmer>
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
