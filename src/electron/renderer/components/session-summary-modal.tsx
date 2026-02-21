import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import type { FinalSummary } from "../../../core/types";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  onAcceptItems?: (
    items: Array<{ text: string; details?: string; source: TaskSource; userIntent?: string }>,
  ) => void;
  onRegenerate?: () => void;
};

type TaskSource = "agreement" | "missed" | "question" | "action";

type TaskCandidate = {
  id: string;
  text: string;
  source: TaskSource;
};

function sourceMeta(source: TaskSource): {
  sectionTitle: string;
  taskTitle: string;
  leftBorderClass: string;
  checkboxClass: string;
} {
  switch (source) {
    case "agreement":
      return {
        sectionTitle: "Agreements",
        taskTitle: "Agreement Tasks",
        leftBorderClass: "border-emerald-500/70",
        checkboxClass: "border-emerald-500/60 data-[selected=true]:bg-emerald-500/25",
      };
    case "missed":
      return {
        sectionTitle: "What We Might Have Missed",
        taskTitle: "Missed Item Tasks",
        leftBorderClass: "border-amber-500/70",
        checkboxClass: "border-amber-500/60 data-[selected=true]:bg-amber-500/25",
      };
    case "question":
      return {
        sectionTitle: "Unanswered Questions",
        taskTitle: "Unanswered Question Tasks",
        leftBorderClass: "border-sky-500/70",
        checkboxClass: "border-sky-500/60 data-[selected=true]:bg-sky-500/25",
      };
    case "action":
      return {
        sectionTitle: "General Action Items",
        taskTitle: "General Action Item Tasks",
        leftBorderClass: "border-violet-500/70",
        checkboxClass: "border-violet-500/60 data-[selected=true]:bg-violet-500/25",
      };
  }
}

function buildTaskSuggestions(item: TaskCandidate): string[] {
  const text = item.text.toLowerCase();

  if (/\b(schedule|meeting|call|sync)\b/.test(text)) {
    return ["Confirm attendees", "Send invite", "Set agenda"];
  }
  if (/\b(document|brief|spec|definition|proposal|outline)\b/.test(text)) {
    return ["Draft outline", "Add details", "Share for review"];
  }
  if (/\b(research|analy|compare|evaluate|investigate)\b/.test(text)) {
    return ["Define criteria", "Compare options", "Summarize findings"];
  }
  if (/\b(set up|setup|configure|integrat|tracking|dashboard|analytics)\b/.test(text)) {
    return ["Create checklist", "Verify setup", "Track baseline"];
  }
  if (/\b(test|experiment|campaign|hypothesis|validate)\b/.test(text)) {
    return ["Define hypothesis", "Set success metric", "Review results"];
  }
  if (/\b(refactor|cleanup|rewrite|modular)\b/.test(text)) {
    return ["Scope modules", "Add tests", "Plan rollout"];
  }
  if (/\b(design|redesign|ui|ux|page)\b/.test(text)) {
    return ["Define UX goal", "Create mockups", "Review with team"];
  }

  switch (item.source) {
    case "agreement":
      return ["Assign owner", "Set deadline", "Define done"];
    case "missed":
      return ["Find evidence", "Reduce risk", "Close gap"];
    case "question":
      return ["Answer question", "Compare options", "Choose direction"];
    case "action":
      return ["First steps", "One-week plan", "Set metric"];
  }
}

function FactList({
  title,
  items,
  source,
}: {
  title: string;
  items: string[];
  source: TaskSource;
}) {
  if (items.length === 0) return null;
  const meta = sourceMeta(source);
  const renderAsParagraphs = source === "agreement";

  return (
    <div className="space-y-1">
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 py-1 text-2xs font-medium text-muted-foreground uppercase tracking-wide backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {title}
      </div>
      {renderAsParagraphs ? (
        <div className="space-y-1.5">
          {items.map((item, idx) => (
            <p key={`${title}-${idx}`} className="text-xs/relaxed text-foreground/90">
              {item}
            </p>
          ))}
        </div>
      ) : (
        <ul className="space-y-1">
          {items.map((item, idx) => (
            <li key={`${title}-${idx}`} className="py-0.5">
              <span className="text-xs/relaxed text-foreground/85">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskRow({
  candidate,
  selected,
  accepted,
  userIntent,
  onIntentChange,
  onToggle,
}: {
  candidate: TaskCandidate;
  selected: boolean;
  accepted: boolean;
  userIntent: string;
  onIntentChange: (value: string) => void;
  onToggle: () => void;
}) {
  const meta = sourceMeta(candidate.source);
  const suggestions = buildTaskSuggestions(candidate);

  return (
    <li
      role="checkbox"
      aria-checked={selected}
      tabIndex={accepted ? -1 : 0}
      onClick={accepted ? undefined : onToggle}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest("input,button,textarea")) return;
        if (!accepted && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`py-1.5 px-2 rounded border-l-2 ${meta.leftBorderClass} transition-colors select-none ${
        accepted ? "opacity-40 cursor-default" : "cursor-pointer hover:bg-muted/60"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div
          data-selected={selected}
          className={`mt-0.5 size-3.5 rounded-[4px] border shrink-0 transition-colors ${meta.checkboxClass} ${
            accepted
              ? "border-muted-foreground/40 bg-muted/20"
              : selected
                ? "border-foreground/40"
                : ""
          }`}
        />
        <div className="flex min-w-0 items-start gap-2">
          <span className={`text-xs/relaxed ${selected && !accepted ? "text-foreground font-medium" : "text-foreground/80"}`}>
            {candidate.text}
          </span>
        </div>
      </div>

      {selected && !accepted && (
        <div
          className="mt-1.5 ml-6 space-y-1.5"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Input
            value={userIntent}
            onChange={(event) => onIntentChange(event.target.value)}
            placeholder="Optional focus for this task"
            className="h-5 rounded-full border-border/70 bg-muted/35 px-2 text-2xs placeholder:text-muted-foreground/90"
            maxLength={180}
          />
          <div className="flex flex-wrap items-center gap-1">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onIntentChange(suggestion);
                }}
                className="inline-flex h-5 items-center rounded-full border border-border/70 bg-muted/35 px-2 text-2xs text-muted-foreground hover:text-foreground hover:bg-muted/55 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

function TaskSection({
  title,
  items,
  selectedIds,
  acceptedIds,
  intentById,
  onIntentChange,
  onToggle,
}: {
  title: string;
  items: TaskCandidate[];
  selectedIds: Set<string>;
  acceptedIds: Set<string>;
  intentById: Record<string, string>;
  onIntentChange: (id: string, value: string) => void;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 py-1 text-2xs font-medium text-muted-foreground uppercase tracking-wide backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {title}
      </div>
      <ul>
        {items.map((item) => (
          <TaskRow
            key={item.id}
            candidate={item}
            selected={selectedIds.has(item.id)}
            accepted={acceptedIds.has(item.id)}
            userIntent={intentById[item.id] ?? ""}
            onIntentChange={(value) => onIntentChange(item.id, value)}
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
  taskCandidates,
  selectedIds,
  acceptedIds,
  intentById,
  onIntentChange,
  onToggle,
}: {
  source: TaskSource;
  facts: string[];
  taskCandidates: TaskCandidate[];
  selectedIds: Set<string>;
  acceptedIds: Set<string>;
  intentById: Record<string, string>;
  onIntentChange: (id: string, value: string) => void;
  onToggle: (id: string) => void;
}) {
  const meta = sourceMeta(source);
  if (facts.length === 0 && taskCandidates.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <FactList title={meta.sectionTitle} items={facts} source={source} />
      <TaskSection
        title={meta.taskTitle}
        items={taskCandidates}
        selectedIds={selectedIds}
        acceptedIds={acceptedIds}
        intentById={intentById}
        onIntentChange={onIntentChange}
        onToggle={onToggle}
      />
    </div>
  );
}

export function SessionSummaryPanel({ state, onClose, onAcceptItems, onRegenerate }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [taskIntentById, setTaskIntentById] = useState<Record<string, string>>({});
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
      setTaskIntentById({});
    }
  }, [state.kind]);

  useEffect(() => {
    setTaskIntentById((prev) => {
      const next: Record<string, string> = {};
      for (const id of selected) {
        const current = prev[id];
        if (current && current.trim()) next[id] = current;
      }
      return next;
    });
  }, [selected]);

  const summary = state.kind === "ready" ? state.summary : null;

  const allTaskCandidates = useMemo(() => {
    if (!summary) {
      return {
        all: [] as TaskCandidate[],
        bySource: {
          agreement: [] as TaskCandidate[],
          missed: [] as TaskCandidate[],
          question: [] as TaskCandidate[],
          action: [] as TaskCandidate[],
        },
      };
    }

    const agreement = summary.agreementTodos.map((text, i) => ({ id: `agreement-task-${i}`, text, source: "agreement" as const }));
    const missed = summary.missedItemTodos.map((text, i) => ({ id: `missed-task-${i}`, text, source: "missed" as const }));
    const question = summary.unansweredQuestionTodos.map((text, i) => ({ id: `question-task-${i}`, text, source: "question" as const }));
    const action = summary.actionItems.map((text, i) => ({ id: `action-task-${i}`, text, source: "action" as const }));

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

  const setIntentForItem = useCallback((id: string, value: string) => {
    setTaskIntentById((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleAcceptSelected = () => {
    if (state.kind !== "ready" || selected.size === 0) return;

    const byId = new Map(allTaskCandidates.all.map((item) => [item.id, item]));
    const payload = [...selected]
      .map((id) => byId.get(id))
      .filter((item): item is TaskCandidate => !!item)
      .map((item) => ({
        text: item.text,
        source: item.source,
        userIntent: taskIntentById[item.id]?.trim() || undefined,
        details: [
          state.summary.narrative ? `Context summary:\n${state.summary.narrative}` : "",
          `Source section: ${sourceMeta(item.source).sectionTitle}`,
          `Source task:\n- ${item.text}`,
        ].filter(Boolean).join("\n\n"),
      }));

    if (payload.length === 0) return;
    onAcceptItems?.(payload);
    setAccepted((prev) => new Set([...prev, ...selected]));
    setSelected(new Set());
    setTaskIntentById({});
  };

  const totalItems = allTaskCandidates.all.length;

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
          {state.kind !== "loading" && onRegenerate && (
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
              <InterleavedSection
                source="agreement"
                facts={summary.agreements}
                taskCandidates={allTaskCandidates.bySource.agreement}
                selectedIds={selected}
                acceptedIds={accepted}
                intentById={taskIntentById}
                onIntentChange={setIntentForItem}
                onToggle={toggleItem}
              />
              <InterleavedSection
                source="missed"
                facts={summary.missedItems}
                taskCandidates={allTaskCandidates.bySource.missed}
                selectedIds={selected}
                acceptedIds={accepted}
                intentById={taskIntentById}
                onIntentChange={setIntentForItem}
                onToggle={toggleItem}
              />
              <InterleavedSection
                source="question"
                facts={summary.unansweredQuestions}
                taskCandidates={allTaskCandidates.bySource.question}
                selectedIds={selected}
                acceptedIds={accepted}
                intentById={taskIntentById}
                onIntentChange={setIntentForItem}
                onToggle={toggleItem}
              />
              <InterleavedSection
                source="action"
                facts={[]}
                taskCandidates={allTaskCandidates.bySource.action}
                selectedIds={selected}
                acceptedIds={accepted}
                intentById={taskIntentById}
                onIntentChange={setIntentForItem}
                onToggle={toggleItem}
              />
            </div>
          </div>
        )}
      </div>

      {state.kind === "ready" && totalItems > 0 && selected.size > 0 && (
        <div className="shrink-0 border-t border-border/80 bg-background px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-2xs text-muted-foreground">
              {`${selected.size} selected`}
            </span>
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
                Add to Tasks
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
