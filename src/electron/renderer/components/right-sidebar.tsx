import { useState, useEffect, useCallback, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { TaskItem, TaskSuggestion, Agent } from "../../../core/types";
import {
  ChevronDownIcon,
  CheckIcon,
  XIcon,
  LoaderCircleIcon,
  PlayIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { WorkoutRunIcon } from "@hugeicons/core-free-icons";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputHeader,
} from "@/components/ai-elements/prompt-input";
import { AgentList } from "./agent-list";
import { AgentDebriefPanel } from "./agent-debrief-panel";
import { useAgentsSummary } from "../hooks/use-agents-summary";
import { SectionLabel } from "@/components/ui/section-label";

const SUGGESTION_TTL_MS = 30_000;
type RightRailMode = "work" | "agents";

type RightSidebarProps = {
  tasks: TaskItem[];
  suggestions: TaskSuggestion[];
  agents?: Agent[];
  selectedAgentId?: string | null;
  onSelectAgent?: (id: string | null) => void;
  onLaunchAgent?: (task: TaskItem) => void;
  onNewAgent?: () => void;
  onAddTask?: (text: string, details?: string) => void;
  onToggleTask?: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onUpdateTask?: (id: string, text: string) => void;
  processingTaskIds?: string[];
  onAcceptSuggestion?: (suggestion: TaskSuggestion) => void;
  onDismissSuggestion?: (id: string) => void;
  sessionId?: string;
  transcriptRefs?: string[];
  onRemoveTranscriptRef?: (index: number) => void;
  onSubmitTaskInput?: (text: string, refs: string[]) => void;
};

function SuggestionItem({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: TaskSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const [opacity, setOpacity] = useState(1);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const age = Date.now() - suggestion.createdAt;
    const remaining = Math.max(0, SUGGESTION_TTL_MS - age);

    setProgress((remaining / SUGGESTION_TTL_MS) * 100);

    const interval = setInterval(() => {
      const elapsed = Date.now() - suggestion.createdAt;
      const pct = Math.max(0, 1 - elapsed / SUGGESTION_TTL_MS) * 100;
      setProgress(pct);
    }, 100);

    const fadeTimer = setTimeout(() => setOpacity(0), Math.max(0, remaining - 500));
    const dismissTimer = setTimeout(onDismiss, remaining);

    return () => {
      clearInterval(interval);
      clearTimeout(fadeTimer);
      clearTimeout(dismissTimer);
    };
  }, [suggestion.createdAt, onDismiss]);

  return (
    <li
      className="relative overflow-hidden border-l-2 border-l-primary/40 bg-primary/5 transition-opacity duration-500"
      style={{ opacity }}
    >
      <div className="flex items-center gap-2 h-7 px-2 relative z-10">
        <span className="text-xs text-foreground truncate flex-1">
          {suggestion.text}
        </span>
        <button
          type="button"
          onClick={onAccept}
          className="shrink-0 p-0.5 text-primary hover:text-primary/80 transition-colors"
          aria-label="Accept suggestion"
        >
          <CheckIcon className="size-3" />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss suggestion"
        >
          <XIcon className="size-3" />
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-primary/5">
        <div className="h-full bg-primary/30 transition-none" style={{ width: `${progress}%` }} />
      </div>
    </li>
  );
}

function EditableTaskItem({
  task,
  isProcessing,
  agent,
  onToggle,
  onDelete,
  onUpdate,
  onLaunchAgent,
  onSelectAgent,
}: {
  task: TaskItem;
  isProcessing: boolean;
  agent?: Agent;
  onToggle?: () => void;
  onDelete?: () => void;
  onUpdate?: (text: string) => void;
  onLaunchAgent?: () => void;
  onSelectAgent?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function handleDoubleClick() {
    if (isProcessing || !onUpdate) return;
    setDraft(task.text);
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== task.text) onUpdate?.(trimmed);
    setEditing(false);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setEditing(false);
  }

  return (
    <li className="flex items-start gap-2 min-h-7 group px-1 -mx-1 rounded-sm hover:bg-muted/30 transition-colors py-1.5">
      {isProcessing ? (
        <LoaderCircleIcon className="size-3 shrink-0 text-muted-foreground animate-spin mt-px" />
      ) : (
        <input
          type="checkbox"
          checked={false}
          onChange={onToggle}
          className="size-3 shrink-0 rounded-sm border-border accent-primary cursor-pointer mt-px"
        />
      )}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKey}
          className="flex-1 text-xs bg-transparent border-b border-primary outline-none"
        />
      ) : (
        <span
          onDoubleClick={handleDoubleClick}
          className={`text-xs flex-1 break-words leading-normal ${isProcessing ? "text-muted-foreground italic" : "text-foreground"} ${onUpdate && !isProcessing ? "cursor-text" : ""}`}
        >
          {task.text}
        </span>
      )}
      {agent && onSelectAgent ? (
        <button
          type="button"
          onClick={() => onSelectAgent(agent.id)}
          className={`shrink-0 p-0.5 mt-px transition-colors ${
            agent.status === "completed"
              ? "text-green-500 hover:text-green-400"
              : "text-destructive hover:text-destructive/80"
          }`}
          aria-label="View agent results"
        >
          <HugeiconsIcon icon={WorkoutRunIcon} className="size-3" />
        </button>
      ) : (
        <div className="flex items-center gap-0.5 shrink-0 mt-px">
          {task.source === "ai" && !isProcessing && !editing && (
            <ZapIcon className="size-3 text-muted-foreground/40 group-hover:invisible" />
          )}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isProcessing && onLaunchAgent && (
              <button
                type="button"
                onClick={onLaunchAgent}
                className="p-0.5 text-muted-foreground hover:text-primary transition-colors"
                aria-label="Run with agent"
              >
                <PlayIcon className="size-3" />
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
              aria-label="Delete task"
            >
              <Trash2Icon className="size-3" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function RailModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "aqua-segment h-7 rounded-sm text-xs transition-colors",
        active
          ? "aqua-segment-active bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-background/70",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function RightSidebar({
  tasks,
  suggestions,
  agents,
  selectedAgentId,
  onSelectAgent,
  onLaunchAgent,
  onNewAgent,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  onUpdateTask,
  processingTaskIds = [],
  onAcceptSuggestion,
  onDismissSuggestion,
  sessionId,
  transcriptRefs = [],
  onRemoveTranscriptRef,
  onSubmitTaskInput,
}: RightSidebarProps) {
  const [mode, setMode] = useLocalStorage<RightRailMode>("ambient-right-rail-mode", "work");
  const [completedOpen, setCompletedOpen] = useState(false);
  const lastAutoOpenedAgentIdRef = useRef<string | null>(null);
  const processingTaskIdSet = new Set(processingTaskIds);

  const { state: debriefState, generate: generateDebrief, canGenerate: canGenerateDebrief, preload: preloadDebrief } =
    useAgentsSummary(agents ?? []);

  useEffect(() => {
    if (!sessionId) return;
    void window.electronAPI.getAgentsSummary(sessionId).then((res) => {
      if (res.ok && res.summary) preloadDebrief(res.summary);
    });
  }, [sessionId, preloadDebrief]);

  const agentByTaskId = new Map<string, Agent>();
  for (const agent of agents ?? []) {
    if (agent.taskId && !agentByTaskId.has(agent.taskId)) {
      agentByTaskId.set(agent.taskId, agent);
    }
  }

  const activeTasks: TaskItem[] = [];
  const completedTasks: TaskItem[] = [];
  let pendingInAgentsCount = 0;
  for (const task of tasks) {
    if (task.completed) {
      completedTasks.push(task);
      continue;
    }
    if (agentByTaskId.get(task.id)?.status === "running") {
      pendingInAgentsCount += 1;
      continue;
    }
    activeTasks.push(task);
  }

  const isViewingPast = !onSubmitTaskInput;
  const completedHaveAgents = completedTasks.some((t) => agentByTaskId.has(t.id));
  useEffect(() => {
    if (isViewingPast && completedHaveAgents) setCompletedOpen(true);
  }, [isViewingPast, completedHaveAgents]);
  useEffect(() => {
    if (transcriptRefs.length > 0 && mode !== "work") {
      setMode("work");
    }
  }, [mode, setMode, transcriptRefs.length]);
  useEffect(() => {
    if (!selectedAgentId) {
      lastAutoOpenedAgentIdRef.current = null;
      return;
    }
    if (selectedAgentId === lastAutoOpenedAgentIdRef.current) return;
    lastAutoOpenedAgentIdRef.current = selectedAgentId;
    if (mode !== "agents") {
      setMode("agents");
    }
  }, [mode, selectedAgentId, setMode]);

  const handleSubmit = useCallback(
    ({ text }: { text: string }) => {
      const refs = transcriptRefs;
      if (!text.trim() && refs.length === 0) return;
      onSubmitTaskInput?.(text.trim(), refs);
    },
    [transcriptRefs, onSubmitTaskInput]
  );

  const hasRefs = transcriptRefs.length > 0;
  const runningAgentsCount = (agents ?? []).filter((agent) => agent.status === "running").length;

  return (
    <div className="aqua-sidebar aqua-sidebar-right w-full h-full shrink-0 border-l border-border flex flex-col min-h-0 bg-sidebar">
      <div className="px-2 py-2 shrink-0 border-b border-border/70">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/50 p-1">
          <RailModeButton
            active={mode === "work"}
            onClick={() => setMode("work")}
            label={`Work (${activeTasks.length + suggestions.length})`}
          />
          <RailModeButton
            active={mode === "agents"}
            onClick={() => setMode("agents")}
            label={runningAgentsCount > 0 ? `Agents (${runningAgentsCount} live)` : `Agents (${(agents ?? []).length})`}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {mode === "work" ? (
          <>
            {/* AI Suggestions */}
            {suggestions.length > 0 && (
              <div className="mb-3">
                <SectionLabel className="sticky top-0 bg-sidebar z-10 -mx-3 px-3 py-1.5 block">Suggested</SectionLabel>
                <ul className="space-y-1">
                  {suggestions.map((s) => (
                    <SuggestionItem
                      key={s.id}
                      suggestion={s}
                      onAccept={() => onAcceptSuggestion?.(s)}
                      onDismiss={() => onDismissSuggestion?.(s.id)}
                    />
                  ))}
                </ul>
              </div>
            )}

            {/* Active tasks */}
            <div className="mb-3">
              <div className="sticky top-0 bg-sidebar z-10 -mx-3 px-3 py-1.5 flex items-center justify-between mb-1.5">
                <SectionLabel as="span">
                  {pendingInAgentsCount > 0 ? `Tasks · ${pendingInAgentsCount} in agents` : "Tasks"}
                </SectionLabel>
                {(() => {
                  const completedByAgent = activeTasks.filter(
                    (t) => agentByTaskId.get(t.id)?.status === "completed"
                  );
                  if (completedByAgent.length === 0) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => completedByAgent.forEach((t) => onToggleTask?.(t.id))}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Complete all ({completedByAgent.length})
                    </button>
                  );
                })()}
              </div>
              {activeTasks.length > 0 ? (
                <ul className="space-y-px">
                  {activeTasks.map((task) => (
                    <EditableTaskItem
                      key={task.id}
                      task={task}
                      isProcessing={processingTaskIdSet.has(task.id)}
                      agent={agentByTaskId.get(task.id)}
                      onToggle={() => onToggleTask?.(task.id)}
                      onDelete={() => onDeleteTask?.(task.id)}
                      onUpdate={onUpdateTask ? (text) => onUpdateTask(task.id, text) : undefined}
                      onLaunchAgent={onLaunchAgent ? () => onLaunchAgent(task) : undefined}
                      onSelectAgent={onSelectAgent ?? undefined}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No active tasks
                </p>
              )}
            </div>

            {/* Completed tasks */}
            {completedTasks.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setCompletedOpen((prev) => !prev)}
                  className="flex items-center gap-1 text-2xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
                >
                  <ChevronDownIcon
                    className={`size-3 transition-transform ${completedOpen ? "" : "-rotate-90"}`}
                  />
                  Completed ({completedTasks.length})
                </button>
                {completedOpen && (
                  <ul className="mt-1.5 space-y-px">
                    {completedTasks.map((task) => {
                      const taskAgent = agentByTaskId.get(task.id);
                      return (
                        <li key={task.id} className="flex items-center gap-2 h-7 group px-1 -mx-1 rounded-sm hover:bg-muted/30 transition-colors">
                          <input
                            type="checkbox"
                            checked
                            onChange={() => onToggleTask?.(task.id)}
                            className="size-3 shrink-0 rounded-sm border-border accent-primary cursor-pointer"
                          />
                          {taskAgent && onSelectAgent ? (
                            <button
                              type="button"
                              onClick={() => onSelectAgent(taskAgent.id)}
                              className="text-xs text-muted-foreground/60 truncate flex-1 text-left line-through hover:text-muted-foreground transition-colors"
                            >
                              {task.text}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground/60 truncate flex-1 line-through">
                              {task.text}
                            </span>
                          )}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            {taskAgent && onSelectAgent && (
                              <button
                                type="button"
                                onClick={() => onSelectAgent(taskAgent.id)}
                                className="p-0.5 text-muted-foreground hover:text-primary transition-colors"
                                aria-label="View agent results"
                              >
                                <HugeiconsIcon icon={WorkoutRunIcon} className="size-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onDeleteTask?.(task.id)}
                              className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                              aria-label="Delete task"
                            >
                              <Trash2Icon className="size-3" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="pt-2">
            {agents && onSelectAgent && agents.length > 0 && (
              <AgentDebriefPanel
                state={debriefState}
                onGenerate={generateDebrief}
                canGenerate={canGenerateDebrief}
                onAddTask={onAddTask}
              />
            )}
            <AgentList
              agents={agents ?? []}
              selectedAgentId={selectedAgentId ?? null}
              onSelectAgent={onSelectAgent ?? (() => {})}
              onNewAgent={onNewAgent}
            />
            {(!agents || agents.length === 0) && (
              <p className="text-xs text-muted-foreground italic">
                Agent activity will appear here once you run a task.
              </p>
            )}
          </div>
        )}
      </div>

      {onSubmitTaskInput && mode === "work" && (
        <div className="px-2 pt-2 pb-2 shrink-0">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputHeader className="px-2 pt-1.5 pb-1 gap-1 min-h-[28px]">
              {hasRefs ? (
                transcriptRefs.map((ref, i) => (
                  <button
                    key={i}
                    type="button"
                    className="flex items-center gap-1 pl-1.5 pr-1 py-0.5 text-2xs bg-muted/50 border border-border/60 rounded-sm text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors max-w-full"
                    onClick={() => onRemoveTranscriptRef?.(i)}
                    title={ref}
                  >
                    <span className="truncate max-w-[160px]">
                      {ref.length > 50 ? `${ref.slice(0, 50)}…` : ref}
                    </span>
                    <XIcon className="size-2.5 shrink-0 opacity-50" />
                  </button>
                ))
              ) : (
                <span className="text-2xs text-muted-foreground/35 select-none italic">
                  Select transcript text · <kbd className="font-mono not-italic">⌘L</kbd> to add context
                </span>
              )}
            </PromptInputHeader>
            <PromptInputTextarea
              placeholder={hasRefs ? "What should these become?" : "Add a task..."}
              className="min-h-0 text-xs"
            />
            <PromptInputFooter className="px-1 py-1">
              <span className="text-2xs text-muted-foreground/35 font-mono select-none pl-1">
                {hasRefs ? `${transcriptRefs.length} snippet${transcriptRefs.length > 1 ? "s" : ""}` : ""}
              </span>
              <PromptInputSubmit size="icon-sm" />
            </PromptInputFooter>
          </PromptInput>
        </div>
      )}
      {onSubmitTaskInput && mode === "agents" && hasRefs && (
        <div className="px-3 py-2 border-t border-border text-2xs text-muted-foreground">
          {transcriptRefs.length} selected snippet{transcriptRefs.length !== 1 ? "s" : ""} ready for task input.
          <button
            type="button"
            onClick={() => setMode("work")}
            className="ml-1 text-foreground hover:text-primary transition-colors"
          >
            Open Work
          </button>
        </div>
      )}
    </div>
  );
}
