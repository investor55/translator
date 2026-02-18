import { useCallback } from "react";
import {
  LoaderCircleIcon,
  RefreshCwIcon,
  CheckCircleIcon,
  XCircleIcon,
  SparklesIcon,
  PlusIcon,
} from "lucide-react";
import type { AgentsSummary } from "../../../core/types";
import type { AgentsSummaryState } from "../hooks/use-agents-summary";

type AgentDebriefPanelProps = {
  state: AgentsSummaryState;
  onGenerate: () => void;
  canGenerate: boolean;
  onAddTodo?: (text: string, details?: string) => void;
};

function formatDuration(totalSecs: number): string {
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function StatusDot({ status }: { status: "completed" | "failed" }) {
  return status === "completed"
    ? <CheckCircleIcon className="size-3 text-green-500 shrink-0 mt-0.5" />
    : <XCircleIcon className="size-3 text-destructive shrink-0 mt-0.5" />;
}

function buildStepContext(summary: AgentsSummary, step: string): string {
  const lines: string[] = [`Next step from agent debrief: ${step}`, "", summary.overallNarrative];
  if (summary.agentHighlights.length > 0) {
    lines.push("", "Agent findings:");
    for (const h of summary.agentHighlights) {
      lines.push(`• ${h.task}: ${h.keyFinding}`);
    }
  }
  return lines.join("\n");
}

function DebriefContent({
  summary,
  onAddTodo,
}: {
  summary: AgentsSummary;
  onAddTodo?: (text: string, details?: string) => void;
}) {
  const handleAddStep = useCallback(
    (step: string) => () => onAddTodo?.(step, buildStepContext(summary, step)),
    [onAddTodo, summary],
  );

  return (
    <div className="space-y-2.5">
      {/* Stats row */}
      <p className="font-mono text-[11px] text-muted-foreground">
        {summary.totalAgents} agents · {summary.succeededAgents} ok
        {summary.failedAgents > 0 ? ` · ${summary.failedAgents} failed` : ""}
        {summary.totalDurationSecs > 0 ? ` · ${formatDuration(summary.totalDurationSecs)}` : ""}
      </p>

      {/* Narrative */}
      <p className="text-xs leading-relaxed text-foreground">
        {summary.overallNarrative}
      </p>

      {/* Per-agent highlights */}
      {summary.agentHighlights.length > 0 && (
        <ul className="space-y-1.5">
          {summary.agentHighlights.map((h) => (
            <li key={h.agentId} className="flex items-start gap-1.5">
              <StatusDot status={h.status} />
              <span className="text-xs leading-relaxed text-muted-foreground">
                <span className="text-foreground font-medium">{h.task.slice(0, 40)}{h.task.length > 40 ? "…" : ""}:</span>{" "}
                {h.keyFinding}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Coverage gaps */}
      {summary.coverageGaps.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Gaps
          </p>
          <ul className="space-y-1">
            {summary.coverageGaps.map((gap, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                <span className="shrink-0">·</span>
                <span>{gap}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Next steps */}
      {summary.nextSteps.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Next Steps
          </p>
          <ul className="space-y-1">
            {summary.nextSteps.map((step, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0 mt-0.5">☐</span>
                <span className="text-xs text-foreground flex-1">{step}</span>
                {onAddTodo && (
                  <button
                    type="button"
                    onClick={handleAddStep(step)}
                    className="shrink-0 rounded-none p-0.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    aria-label="Add to todos"
                  >
                    <PlusIcon className="size-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AgentDebriefPanel({
  state,
  onGenerate,
  canGenerate,
  onAddTodo,
}: AgentDebriefPanelProps) {
  if (state.kind === "idle") return null;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1">
          <SparklesIcon className="size-3 text-muted-foreground" />
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Agent Debrief
          </span>
        </div>
        {canGenerate && state.kind !== "loading" && (
          <button
            type="button"
            onClick={onGenerate}
            className="rounded-none p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Regenerate debrief"
          >
            <RefreshCwIcon className="size-3" />
          </button>
        )}
      </div>

      {state.kind === "loading" && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3 animate-spin shrink-0" />
          Generating debrief…
        </div>
      )}

      {state.kind === "error" && (
        <div className="space-y-1.5">
          <p className="text-xs text-destructive">{state.message}</p>
          {canGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {state.kind === "ready" && (
        <DebriefContent summary={state.summary} onAddTodo={onAddTodo} />
      )}
    </div>
  );
}
