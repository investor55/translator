import { useState, useEffect } from "react";
import { CheckIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import type { FinalSummary } from "../../../core/types";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

export type SummaryModalState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; summary: FinalSummary }
  | { kind: "error"; message: string };

type Props = {
  state: SummaryModalState;
  onClose: () => void;
  onAcceptItems?: (items: Array<{ text: string; details?: string }>) => void;
  onRegenerate?: () => void;
};

function ActionItemRow({
  text,
  selected,
  accepted,
  onToggle,
}: {
  text: string;
  selected: boolean;
  accepted: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      role="checkbox"
      aria-checked={selected}
      tabIndex={accepted ? -1 : 0}
      onClick={accepted ? undefined : onToggle}
      onKeyDown={(e) => {
        if (!accepted && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`flex items-center gap-2.5 py-1.5 px-2 rounded transition-colors select-none ${
        accepted ? "opacity-40 cursor-default" : "cursor-pointer hover:bg-muted/60"
      }`}
    >
      <div
        className={`size-3.5 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
          accepted
            ? "border-muted-foreground/40"
            : selected
              ? "border-foreground bg-foreground"
              : "border-muted-foreground/60"
        }`}
      >
        {(accepted || selected) && (
          <CheckIcon className={`size-2 ${accepted ? "text-muted-foreground/60" : "text-background"}`} />
        )}
      </div>
      <span className={`text-xs/relaxed ${selected && !accepted ? "text-foreground font-medium" : "text-foreground/80"}`}>
        {text}
      </span>
    </li>
  );
}

export function SessionSummaryPanel({ state, onClose, onAcceptItems, onRegenerate }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [accepted, setAccepted] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (state.kind === "ready") {
      setSelected(new Set());
      setAccepted(new Set());
    }
  }, [state.kind]);

  if (state.kind === "idle") return null;

  const toggleItem = (i: number) => {
    if (accepted.has(i)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleAcceptSelected = () => {
    if (state.kind !== "ready" || selected.size === 0) return;
    const items = [...selected].map((i) => ({
      text: state.summary.actionItems[i],
      details: state.summary.narrative ? `Context summary:\n${state.summary.narrative}` : undefined,
    }));
    onAcceptItems?.(items);
    setAccepted((prev) => new Set([...prev, ...selected]));
    setSelected(new Set());
  };

  const summary = state.kind === "ready" ? state.summary : null;
  const totalItems = summary?.actionItems.length ?? 0;
  const remainingItems = totalItems - accepted.size;

  return (
    <div className="shrink-0 border-t border-border bg-background flex flex-col max-h-64">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <span className="text-xs font-medium text-foreground">Session Summary</span>
        <div className="flex items-center gap-1">
          {state.kind === "ready" && onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
              aria-label="Regenerate summary"
              title="Regenerate"
            >
              <RefreshCwIcon className="size-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            aria-label="Close summary"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="overflow-y-auto flex-1 min-h-0 px-4 pb-3">
        {state.kind === "loading" && (
          <div className="flex items-center gap-2 text-muted-foreground py-2">
            <Spinner className="size-3.5" />
            <span className="text-xs">Generating summary...</span>
          </div>
        )}

        {state.kind === "error" && (
          <p className="text-xs text-destructive py-1">{state.message}</p>
        )}

        {state.kind === "ready" && summary && (
          <div className="space-y-3">
            <p className="text-xs/relaxed text-foreground/90">{summary.narrative}</p>

            {summary.actionItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-2xs text-muted-foreground">
                    {selected.size > 0
                      ? `${selected.size} selected`
                      : `${remainingItems} action item${remainingItems !== 1 ? "s" : ""}`}
                  </span>
                  {selected.size > 0 ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setSelected(new Set())}
                      >
                        Deselect all
                      </button>
                      <Button size="sm" onClick={handleAcceptSelected} className="gap-1 h-6 text-2xs px-2">
                        <PlusIcon className="size-2.5" />
                        Add to Todos
                      </Button>
                    </div>
                  ) : remainingItems > 0 ? (
                    <button
                      type="button"
                      className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() =>
                        setSelected(
                          new Set(summary.actionItems.map((_, i) => i).filter((i) => !accepted.has(i)))
                        )
                      }
                    >
                      Select all
                    </button>
                  ) : null}
                </div>
                <ul>
                  {summary.actionItems.map((item, i) => (
                    <ActionItemRow
                      key={i}
                      text={item}
                      selected={selected.has(i)}
                      accepted={accepted.has(i)}
                      onToggle={() => toggleItem(i)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
