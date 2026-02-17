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
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
} from "@/components/ai-elements/tool";
import { useStickToBottomContext } from "use-stick-to-bottom";
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
}: {
  step: AgentStep;
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
    default:
      return null;
  }
}

type TimelineItem =
  | { kind: "step"; step: AgentStep }
  | {
      kind: "activity";
      id: string;
      title: string;
      steps: AgentStep[];
      isStreaming: boolean;
    };

function getActivityTitle(steps: AgentStep[]): string {
  const hasThought = steps.some((step) => step.kind === "thinking");
  const toolSteps = steps.filter((step) => step.kind !== "thinking");
  const searchCount = toolSteps.filter((step) => step.toolName === "searchWeb").length;

  if (hasThought && searchCount > 0) {
    return `Thought + ${searchCount} search${searchCount === 1 ? "" : "es"}`;
  }
  if (hasThought && toolSteps.length > 0) {
    return `Thought + ${toolSteps.length} tool${toolSteps.length === 1 ? "" : "s"}`;
  }
  if (hasThought) {
    return "Thought process";
  }
  if (searchCount > 0) {
    return `Did ${searchCount} search${searchCount === 1 ? "" : "es"}`;
  }
  return `Used ${toolSteps.length} tool${toolSteps.length === 1 ? "" : "s"}`;
}

function ActivitySummaryItem({
  title,
  steps,
  isStreaming,
}: {
  title: string;
  steps: AgentStep[];
  isStreaming: boolean;
}) {
  const { stopScroll } = useStickToBottomContext();

  return (
    <div className="py-0.5 border-t border-border mt-1">
      <Tool defaultOpen={false} isStreaming={isStreaming}>
        <ToolHeader
          onClickCapture={() => stopScroll()}
          state={isStreaming ? "input-streaming" : "output-available"}
          title={title}
          type="tool-summary"
        />
        <ToolContent>
          <div className="space-y-1.5">
            {steps.map((step) => (
              <div className="rounded-none border border-border/50 px-1.5 py-1" key={step.id}>
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {step.kind === "thinking" ? "Thought" : "Action"}
                </p>
                <div className="text-[11px] text-muted-foreground leading-relaxed [&_a]:text-primary [&_a]:underline">
                  <MessageResponse>{step.content}</MessageResponse>
                </div>
              </div>
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
    () => {
      const filtered = agent.steps.filter(
        (step) =>
          step.kind === "user" ||
          step.kind === "text" ||
          step.kind === "thinking" ||
          step.kind === "tool-call" ||
          step.kind === "tool-result"
      );

      const trimmedTask = agent.task.trim();
      const firstNonUserAt = filtered.reduce((earliest, step) => {
        if (step.kind === "user") return earliest;
        return Math.min(earliest, step.createdAt);
      }, Number.POSITIVE_INFINITY);

      const hasInitialPromptStep = filtered.some(
        (step) =>
          step.kind === "user" &&
          step.content.trim() === trimmedTask &&
          step.createdAt <= firstNonUserAt
      );

      const withInitialPrompt =
        trimmedTask && !hasInitialPromptStep
          ? [
              {
                id: `initial-user:${agent.id}`,
                kind: "user" as const,
                content: trimmedTask,
                createdAt: agent.createdAt,
              },
              ...filtered,
            ]
          : filtered;

      // Preserve event order from the agent stream; timestamp sorting can
      // mis-order tool/thought vs final text because text uses turn start time.
      return withInitialPrompt;
    },
    [agent.createdAt, agent.id, agent.steps, agent.task]
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
  const timelineItems = useMemo(() => {
    const items: TimelineItem[] = [];
    let pendingActivity: AgentStep[] = [];
    let activityIndex = 0;

    const flushActivity = () => {
      if (pendingActivity.length === 0) return;
      const steps = pendingActivity;
      pendingActivity = [];
      const id = `activity:${agent.id}:${activityIndex}`;
      activityIndex += 1;
      const isCurrentTurnGroup = steps.some(
        (step) => step.createdAt >= activeTurnStartAt
      );
      items.push({
        kind: "activity",
        id,
        steps,
        title: getActivityTitle(steps),
        isStreaming: isRunning && !hasCurrentTurnText && isCurrentTurnGroup,
      });
    };

    for (const step of visibleSteps) {
      if (
        step.kind === "thinking" ||
        step.kind === "tool-call" ||
        step.kind === "tool-result"
      ) {
        pendingActivity.push(step);
        continue;
      }
      flushActivity();
      items.push({ kind: "step", step });
    }

    flushActivity();
    return items;
  }, [activeTurnStartAt, agent.id, hasCurrentTurnText, isRunning, visibleSteps]);

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
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
            Agent
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
          {timelineItems.map((item) =>
            item.kind === "activity" ? (
              <ActivitySummaryItem
                key={item.id}
                isStreaming={item.isStreaming}
                steps={item.steps}
                title={item.title}
              />
            ) : (
              <StepItem key={item.step.id} step={item.step} />
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
