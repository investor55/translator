import { useCallback, useMemo, useState } from "react";
import {
  XIcon,
  CheckIcon,
  LoaderCircleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SquareIcon,
  SearchIcon,
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
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
} from "@/components/ai-elements/confirmation";
import { useStickToBottomContext } from "use-stick-to-bottom";
import type {
  Agent,
  AgentStep,
  AgentQuestionRequest,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
} from "../../../core/types";

type FollowUpResult = { ok: boolean; error?: string };
type AnswerQuestionResult = { ok: boolean; error?: string };
type AnswerToolApprovalResult = { ok: boolean; error?: string };

type AgentDetailPanelProps = {
  agent: Agent;
  agents: Agent[];
  onSelectAgent: (id: string) => void;
  onClose: () => void;
  onFollowUp?: (agent: Agent, question: string) => Promise<FollowUpResult> | FollowUpResult;
  onAnswerQuestion?: (
    agent: Agent,
    answers: AgentQuestionSelection[],
  ) => Promise<AnswerQuestionResult> | AnswerQuestionResult;
  onAnswerToolApproval?: (
    agent: Agent,
    response: AgentToolApprovalResponse,
  ) => Promise<AnswerToolApprovalResult> | AnswerToolApprovalResult;
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

type AskQuestionToolOutput = {
  title?: string;
  questions: AgentQuestionRequest["questions"];
  answers: AgentQuestionSelection[];
};

function parseAskQuestionRequest(raw: string | undefined): AgentQuestionRequest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentQuestionRequest>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) return null;
    const questions = parsed.questions
      .map((question) => {
        if (!question || typeof question !== "object") return null;
        if (typeof question.id !== "string" || !question.id.trim()) return null;
        if (typeof question.prompt !== "string" || !question.prompt.trim()) return null;
        if (!Array.isArray(question.options) || question.options.length === 0) return null;
        const options = question.options
          .map((option) => {
            if (!option || typeof option !== "object") return null;
            if (typeof option.id !== "string" || !option.id.trim()) return null;
            if (typeof option.label !== "string" || !option.label.trim()) return null;
            return { id: option.id, label: option.label };
          })
          .filter((option): option is { id: string; label: string } => !!option);
        if (options.length === 0) return null;
        return {
          id: question.id,
          prompt: question.prompt,
          options,
          allow_multiple: question.allow_multiple === true,
        };
      })
      .filter(Boolean) as AgentQuestionRequest["questions"];
    if (questions.length === 0) return null;
    return {
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      questions,
    };
  } catch {
    return null;
  }
}

function parseAskQuestionOutput(raw: string | undefined): AskQuestionToolOutput | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AskQuestionToolOutput>;
    if (!parsed || typeof parsed !== "object") return null;
    const questionRequest = parseAskQuestionRequest(JSON.stringify({
      title: parsed.title,
      questions: parsed.questions,
    }));
    if (!questionRequest) return null;
    const answers = Array.isArray(parsed.answers)
      ? parsed.answers
          .map((answer) => {
            if (!answer || typeof answer !== "object") return null;
            if (typeof answer.questionId !== "string" || !answer.questionId.trim()) return null;
            if (!Array.isArray(answer.selectedOptionIds)) return null;
            const selectedOptionIds = answer.selectedOptionIds
              .map((id) => (typeof id === "string" ? id.trim() : ""))
              .filter(Boolean);
            return { questionId: answer.questionId, selectedOptionIds };
          })
          .filter((answer): answer is AgentQuestionSelection => !!answer)
      : [];

    return {
      title: questionRequest.title,
      questions: questionRequest.questions,
      answers,
    };
  } catch {
    return null;
  }
}

function isAskQuestionStep(step: AgentStep): boolean {
  return step.toolName === "askQuestion"
    && (step.kind === "tool-call" || step.kind === "tool-result");
}

function isToolApprovalStep(step: AgentStep): boolean {
  return !!step.approvalState && !!step.approvalId;
}

function formatToolName(toolName?: string): string {
  if (!toolName) return "Tool";
  return toolName
    .replace(/^notion__/, "Notion / ")
    .replace(/^linear__/, "Linear / ");
}

function AskQuestionPendingCard({
  agent,
  request,
  onAnswerQuestion,
}: {
  agent: Agent;
  request: AgentQuestionRequest;
  onAnswerQuestion?: (
    agent: Agent,
    answers: AgentQuestionSelection[],
  ) => Promise<AnswerQuestionResult> | AnswerQuestionResult;
}) {
  const [selectionByQuestion, setSelectionByQuestion] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const toggleOption = useCallback((questionId: string, optionId: string, allowMultiple: boolean) => {
    setSelectionByQuestion((current) => {
      const existing = current[questionId] ?? [];
      if (!allowMultiple) {
        if (existing.length === 1 && existing[0] === optionId) {
          return { ...current, [questionId]: [] };
        }
        return { ...current, [questionId]: [optionId] };
      }

      if (existing.includes(optionId)) {
        return { ...current, [questionId]: existing.filter((id) => id !== optionId) };
      }
      return { ...current, [questionId]: [...existing, optionId] };
    });
  }, []);

  const canSubmit = useMemo(
    () =>
      request.questions.every(
        (question) => (selectionByQuestion[question.id]?.length ?? 0) > 0
      ),
    [request.questions, selectionByQuestion]
  );

  const handleSubmit = useCallback(async () => {
    if (!onAnswerQuestion) return;
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    const answers: AgentQuestionSelection[] = request.questions.map((question) => ({
      questionId: question.id,
      selectedOptionIds: selectionByQuestion[question.id] ?? [],
    }));
    try {
      const result = await onAnswerQuestion(agent, answers);
      if (result.ok) return;
      setSubmitError(result.error ?? "Could not submit answers.");
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "Could not submit answers.";
      setSubmitError(errorText);
      setSubmitting(false);
    }
  }, [agent, canSubmit, onAnswerQuestion, request.questions, selectionByQuestion]);

  return (
    <div className="mt-1 border-t border-border pt-2">
      <div className="rounded-none border border-border bg-muted/20 px-2 py-2">
        <p className="text-[11px] font-semibold text-foreground">
          {request.title || "Questions"}
        </p>
        <div className="mt-1.5 space-y-2">
          {request.questions.map((question, index) => {
            const selected = selectionByQuestion[question.id] ?? [];
            return (
              <div key={question.id}>
                <p className="text-[11px] text-foreground font-medium">
                  {index + 1}. {question.prompt}
                </p>
                <div className="mt-1 flex flex-col gap-1">
                  {question.options.map((option) => {
                    const isSelected = selected.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => toggleOption(question.id, option.id, !!question.allow_multiple)}
                        className={[
                          "flex items-center gap-2 rounded-none border px-2 py-1 text-left text-[11px] transition-colors",
                          isSelected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/80 text-muted-foreground hover:border-border hover:text-foreground",
                        ].join(" ")}
                      >
                        <span className="inline-flex h-4 min-w-4 items-center justify-center border border-current px-1 text-[10px] font-semibold uppercase">
                          {option.id.slice(0, 1)}
                        </span>
                        <span className="leading-relaxed">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between">
          {submitError ? (
            <p className="text-[11px] text-destructive">{submitError}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Choose an option for each question.
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!onAnswerQuestion || !canSubmit || submitting}
            className="rounded-none border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AskQuestionResolvedCard({ output }: { output: AskQuestionToolOutput }) {
  const answersByQuestionId = new Map(
    output.answers.map((answer) => [answer.questionId, answer.selectedOptionIds])
  );

  return (
    <div className="mt-1 border-t border-border pt-2">
      <div className="rounded-none border border-border/70 bg-muted/10 px-2 py-2">
        <p className="text-[11px] font-semibold text-foreground">
          {output.title || "Clarification received"}
        </p>
        <div className="mt-1 space-y-1.5">
          {output.questions.map((question) => {
            const selectedIds = answersByQuestionId.get(question.id) ?? [];
            const selectedLabels = question.options
              .filter((option) => selectedIds.includes(option.id))
              .map((option) => option.label);
            return (
              <div key={question.id}>
                <p className="text-[11px] font-medium text-foreground">{question.prompt}</p>
                <p className="text-[11px] text-muted-foreground">
                  {selectedLabels.length > 0 ? selectedLabels.join(", ") : "No selection"}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ToolApprovalCard({
  agent,
  step,
  onAnswerToolApproval,
}: {
  agent: Agent;
  step: AgentStep;
  onAnswerToolApproval?: (
    agent: Agent,
    response: AgentToolApprovalResponse,
  ) => Promise<AnswerToolApprovalResult> | AnswerToolApprovalResult;
}) {
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [submitError, setSubmitError] = useState("");
  const approvalId = step.approvalId;
  const approvalState = step.approvalState;
  if (!approvalId || !approvalState) return null;

  const submitApproval = async (approved: boolean) => {
    if (!onAnswerToolApproval || approvalState !== "approval-requested") return;
    setSubmitError("");
    setSubmitting(approved ? "approve" : "reject");
    const result = await onAnswerToolApproval(agent, { approvalId, approved });
    setSubmitting(null);
    if (!result.ok) {
      setSubmitError(result.error ?? "Could not submit approval.");
    }
  };

  return (
    <div className="mt-1 border-t border-border pt-2">
      <Confirmation state={approvalState} approved={step.approvalApproved}>
        <ConfirmationRequest>
          <p className="text-[11px] font-semibold">{formatToolName(step.toolName)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            {step.content}
          </p>
          {step.toolInput && (
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap border border-border/70 bg-background px-2 py-1 text-[10px] text-muted-foreground">
              {step.toolInput}
            </pre>
          )}
        </ConfirmationRequest>
        <ConfirmationAccepted>
          <CheckIcon className="size-3.5" />
          <span>{step.content}</span>
        </ConfirmationAccepted>
        <ConfirmationRejected>
          <XIcon className="size-3.5" />
          <span>{step.content}</span>
        </ConfirmationRejected>
        <ConfirmationActions>
          <ConfirmationAction
            variant="outline"
            disabled={!onAnswerToolApproval || submitting !== null}
            onClick={() => void submitApproval(false)}
          >
            Reject
          </ConfirmationAction>
          <ConfirmationAction
            disabled={!onAnswerToolApproval || submitting !== null}
            onClick={() => void submitApproval(true)}
          >
            Approve
          </ConfirmationAction>
        </ConfirmationActions>
        {submitError && (
          <p className="mt-1 text-[11px] text-destructive">{submitError}</p>
        )}
      </Confirmation>
    </div>
  );
}

function StepItem({
  agent,
  step,
  onAnswerQuestion,
  onAnswerToolApproval,
}: {
  agent: Agent;
  step: AgentStep;
  onAnswerQuestion?: (
    agent: Agent,
    answers: AgentQuestionSelection[],
  ) => Promise<AnswerQuestionResult> | AnswerQuestionResult;
  onAnswerToolApproval?: (
    agent: Agent,
    response: AgentToolApprovalResponse,
  ) => Promise<AnswerToolApprovalResult> | AnswerToolApprovalResult;
}) {
  if (isToolApprovalStep(step)) {
    return (
      <ToolApprovalCard
        agent={agent}
        step={step}
        onAnswerToolApproval={onAnswerToolApproval}
      />
    );
  }

  if (step.kind === "tool-call" && step.toolName === "askQuestion") {
    const request = parseAskQuestionRequest(step.toolInput);
    if (!request) return null;
    return (
      <AskQuestionPendingCard
        agent={agent}
        request={request}
        onAnswerQuestion={onAnswerQuestion}
      />
    );
  }

  if (step.kind === "tool-result" && step.toolName === "askQuestion") {
    const output = parseAskQuestionOutput(step.toolInput);
    if (!output) return null;
    return <AskQuestionResolvedCard output={output} />;
  }

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

function getToolCallCount(steps: AgentStep[]): number {
  const toolCallIds = new Set<string>();
  for (const step of steps) {
    if (step.kind === "tool-call" || step.kind === "tool-result") {
      toolCallIds.add(step.id);
    }
  }
  return toolCallIds.size;
}

function getSearchQuery(step: AgentStep): string | null {
  if (step.toolName !== "searchWeb") return null;
  const match = step.content.match(/^Searched:\s*(.+)$/i);
  const query = match?.[1]?.trim();
  return query ? query : null;
}

function getActivityStepSummary(step: AgentStep): string {
  if (step.kind === "thinking") return "Thought";
  if (step.toolName === "searchWeb") return "Search";
  if (step.toolName) return `Tool: ${step.toolName}`;
  return "Action";
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
  const toolCallCount = getToolCallCount(steps);
  const toolCallSummary = `${toolCallCount} tool${toolCallCount === 1 ? "" : "s"} called`;

  return (
    <div className="py-0.5 border-t border-border mt-1">
      <ChainOfThought defaultOpen={false} isStreaming={isStreaming}>
        <ChainOfThoughtHeader onClickCapture={() => stopScroll()}>
          {toolCallSummary}
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {title}
          </p>
          <div className="space-y-1.5">
            {steps.map((step, index) => {
              const searchQuery = getSearchQuery(step);
              const isActive = isStreaming && index === steps.length - 1;
              return (
                <ChainOfThoughtStep
                  key={`${step.id}:${step.kind}`}
                  description={getActivityStepSummary(step)}
                  icon={searchQuery ? SearchIcon : undefined}
                  label={<MessageResponse>{step.content}</MessageResponse>}
                  status={isActive ? "active" : "complete"}
                >
                  {searchQuery ? (
                    <ChainOfThoughtSearchResults>
                      <ChainOfThoughtSearchResult>
                        {searchQuery}
                      </ChainOfThoughtSearchResult>
                    </ChainOfThoughtSearchResults>
                  ) : null}
                </ChainOfThoughtStep>
              );
            })}
          </div>
        </ChainOfThoughtContent>
      </ChainOfThought>
    </div>
  );
}

function TaskContextCard({ task, taskContext }: { task: string; taskContext?: string }) {
  const contextText = taskContext?.trim();
  if (!contextText) return null;

  return (
    <div className="shrink-0 border-b border-border bg-muted/20 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Todo
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-foreground">{task}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
          Context
        </summary>
        <div className="mt-1 max-h-40 overflow-y-auto rounded-none border border-border/60 bg-background px-2 py-1.5">
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
            {contextText}
          </p>
        </div>
      </details>
    </div>
  );
}

export function AgentDetailPanel({
  agent,
  agents,
  onSelectAgent,
  onClose,
  onFollowUp,
  onAnswerQuestion,
  onAnswerToolApproval,
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
      if (isAskQuestionStep(step)) {
        flushActivity();
        items.push({ kind: "step", step });
        continue;
      }
      if (isToolApprovalStep(step)) {
        flushActivity();
        items.push({ kind: "step", step });
        continue;
      }
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
    <div className="w-full h-full shrink-0 border-l border-border flex flex-col min-h-0 bg-sidebar">
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

      <TaskContextCard task={agent.task} taskContext={agent.taskContext} />

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
              <StepItem
                key={item.step.id}
                agent={agent}
                step={item.step}
                onAnswerQuestion={onAnswerQuestion}
                onAnswerToolApproval={onAnswerToolApproval}
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
