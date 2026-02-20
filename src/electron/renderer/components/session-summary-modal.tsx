import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CheckIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import type { FinalSummary } from "../../../core/types";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { MessageResponse } from "@/components/ai-elements/message";

export type SummaryModalState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; summary: FinalSummary }
  | { kind: "error"; message: string };

const DEFAULT_PANEL_HEIGHT = 260;
const MIN_PANEL_HEIGHT = 150;

function getMaxPanelHeight(): number {
  if (typeof window === "undefined") return 560;
  return Math.max(MIN_PANEL_HEIGHT + 80, Math.floor(window.innerHeight * 0.7));
}

function clampPanelHeight(height: number): number {
  return Math.min(Math.max(height, MIN_PANEL_HEIGHT), getMaxPanelHeight());
}

type Props = {
  state: SummaryModalState;
  onClose: () => void;
  onAcceptItems?: (items: Array<{ text: string; details?: string }>) => void;
  onRegenerate?: () => void;
};

type TodoSource = "agreement" | "missed" | "question" | "action";

type TodoCandidate = {
  id: string;
  text: string;
  source: TodoSource;
};

function sourceMeta(source: TodoSource): {
  sectionTitle: string;
  todoTitle: string;
  badge: string;
  markerClass: string;
} {
  switch (source) {
    case "agreement":
      return {
        sectionTitle: "Agreements",
        todoTitle: "Agreement Todos",
        badge: "A",
        markerClass: "bg-emerald-500/20 border-emerald-500/35",
      };
    case "missed":
      return {
        sectionTitle: "What We Might Have Missed",
        todoTitle: "Missed Item Todos",
        badge: "M",
        markerClass: "bg-amber-500/20 border-amber-500/35",
      };
    case "question":
      return {
        sectionTitle: "Unanswered Questions",
        todoTitle: "Unanswered Question Todos",
        badge: "Q",
        markerClass: "bg-sky-500/20 border-sky-500/35",
      };
    case "action":
      return {
        sectionTitle: "General Action Items",
        todoTitle: "General Action Item Todos",
        badge: "G",
        markerClass: "bg-violet-500/20 border-violet-500/35",
      };
  }
}

function FactList({
  title,
  items,
  source,
}: {
  title: string;
  items: string[];
  source: TodoSource;
}) {
  if (items.length === 0) return null;
  const meta = sourceMeta(source);

  return (
    <div className="space-y-1">
      <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((item, idx) => (
          <li key={`${title}-${idx}`} className="flex items-start gap-2">
            <span className={`mt-1.5 inline-block size-1.5 rounded-full border ${meta.markerClass}`} />
            <span className="text-xs/relaxed text-foreground/85">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TodoRow({
  candidate,
  selected,
  accepted,
  onToggle,
}: {
  candidate: TodoCandidate;
  selected: boolean;
  accepted: boolean;
  onToggle: () => void;
}) {
  const meta = sourceMeta(candidate.source);

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
      <div className="flex min-w-0 items-start gap-2">
        <span className={`mt-0.5 inline-block shrink-0 rounded border px-1 py-0 text-[9px] leading-4 font-medium text-muted-foreground ${meta.markerClass}`}>
          {meta.badge}
        </span>
        <span className={`text-xs/relaxed ${selected && !accepted ? "text-foreground font-medium" : "text-foreground/80"}`}>
          {candidate.text}
        </span>
      </div>
    </li>
  );
}

function TodoSection({
  title,
  items,
  selectedIds,
  acceptedIds,
  onToggle,
}: {
  title: string;
  items: TodoCandidate[];
  selectedIds: Set<string>;
  acceptedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </div>
      <ul>
        {items.map((item) => (
          <TodoRow
            key={item.id}
            candidate={item}
            selected={selectedIds.has(item.id)}
            accepted={acceptedIds.has(item.id)}
            onToggle={() => onToggle(item.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function InterleavedSection({
  source,
  facts,
  todos,
  selectedIds,
  acceptedIds,
  onToggle,
}: {
  source: TodoSource;
  facts: string[];
  todos: TodoCandidate[];
  selectedIds: Set<string>;
  acceptedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const meta = sourceMeta(source);
  if (facts.length === 0 && todos.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <FactList title={meta.sectionTitle} items={facts} source={source} />
      <TodoSection
        title={meta.todoTitle}
        items={todos}
        selectedIds={selectedIds}
        acceptedIds={acceptedIds}
        onToggle={onToggle}
      />
    </div>
  );
}

export function SessionSummaryPanel({ state, onClose, onAcceptItems, onRegenerate }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);

  const stopResizing = useCallback(() => {
    resizeStartRef.current = null;
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!resizeStartRef.current) return;
      const deltaY = resizeStartRef.current.y - event.clientY;
      setPanelHeight(clampPanelHeight(resizeStartRef.current.height + deltaY));
    };

    const onWindowResize = () => {
      setPanelHeight((current) => clampPanelHeight(current));
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      window.removeEventListener("resize", onWindowResize);
    };
  }, [stopResizing]);

  useEffect(() => {
    if (state.kind === "ready") {
      setSelected(new Set());
      setAccepted(new Set());
    }
  }, [state.kind]);

  const summary = state.kind === "ready" ? state.summary : null;

  const todos = useMemo(() => {
    if (!summary) {
      return {
        all: [] as TodoCandidate[],
        bySource: {
          agreement: [] as TodoCandidate[],
          missed: [] as TodoCandidate[],
          question: [] as TodoCandidate[],
          action: [] as TodoCandidate[],
        },
      };
    }

    const agreement = summary.agreementTodos.map((text, i) => ({ id: `agreement-todo-${i}`, text, source: "agreement" as const }));
    const missed = summary.missedItemTodos.map((text, i) => ({ id: `missed-todo-${i}`, text, source: "missed" as const }));
    const question = summary.unansweredQuestionTodos.map((text, i) => ({ id: `question-todo-${i}`, text, source: "question" as const }));
    const action = summary.actionItems.map((text, i) => ({ id: `action-todo-${i}`, text, source: "action" as const }));

    return {
      all: [...agreement, ...missed, ...question, ...action],
      bySource: { agreement, missed, question, action },
    };
  }, [summary]);

  const toggleItem = (id: string) => {
    if (accepted.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAcceptSelected = () => {
    if (state.kind !== "ready" || selected.size === 0) return;

    const byId = new Map(todos.all.map((item) => [item.id, item]));
    const payload = [...selected]
      .map((id) => byId.get(id))
      .filter((item): item is TodoCandidate => !!item)
      .map((item) => ({
        text: item.text,
        details: [
          state.summary.narrative ? `Context summary:\n${state.summary.narrative}` : "",
          `Source section: ${sourceMeta(item.source).sectionTitle}`,
          `Source todo:\n- ${item.text}`,
        ].filter(Boolean).join("\n\n"),
      }));

    if (payload.length === 0) return;
    onAcceptItems?.(payload);
    setAccepted((prev) => new Set([...prev, ...selected]));
    setSelected(new Set());
  };

  const totalItems = todos.all.length;
  const remainingItems = Math.max(0, totalItems - accepted.size);

  if (state.kind === "idle") return null;

  return (
    <div className="shrink-0 border-t border-border bg-background flex flex-col" style={{ height: panelHeight }}>
      <div
        role="separator"
        aria-label="Resize summary panel"
        aria-orientation="horizontal"
        className="group relative h-2 shrink-0 cursor-row-resize bg-transparent hover:bg-border/30"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          resizeStartRef.current = { y: event.clientY, height: panelHeight };
          event.preventDefault();
        }}
      >
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-14 -translate-x-1/2 -translate-y-1/2 bg-border/80 transition-colors group-hover:bg-foreground/35" />
      </div>

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
            <MessageResponse className="text-xs/relaxed text-foreground/90 [&_h3]:mt-2 [&_h3]:text-2xs [&_h3]:font-semibold [&_li]:my-0.5">
              {summary.narrative}
            </MessageResponse>

            <div className="space-y-2">
              {totalItems > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-2xs text-muted-foreground">
                    {selected.size > 0
                      ? `${selected.size} selected`
                      : `${remainingItems} todo suggestion${remainingItems !== 1 ? "s" : ""} available`}
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
                          new Set(todos.all.map((item) => item.id).filter((id) => !accepted.has(id)))
                        )
                      }
                    >
                      Select all
                    </button>
                  ) : null}
                </div>
              )}

              <InterleavedSection
                source="agreement"
                facts={summary.agreements}
                todos={todos.bySource.agreement}
                selectedIds={selected}
                acceptedIds={accepted}
                onToggle={toggleItem}
              />
              <InterleavedSection
                source="missed"
                facts={summary.missedItems}
                todos={todos.bySource.missed}
                selectedIds={selected}
                acceptedIds={accepted}
                onToggle={toggleItem}
              />
              <InterleavedSection
                source="question"
                facts={summary.unansweredQuestions}
                todos={todos.bySource.question}
                selectedIds={selected}
                acceptedIds={accepted}
                onToggle={toggleItem}
              />
              <InterleavedSection
                source="action"
                facts={[]}
                todos={todos.bySource.action}
                selectedIds={selected}
                acceptedIds={accepted}
                onToggle={toggleItem}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
