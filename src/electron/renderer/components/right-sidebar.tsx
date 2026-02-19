import { useState, useEffect, useCallback, useRef } from "react";
import type { TodoItem, TodoSuggestion, Agent } from "../../../core/types";
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
import { Separator } from "@/components/ui/separator";
import { SectionLabel } from "@/components/ui/section-label";

const SUGGESTION_TTL_MS = 30_000;

type RightSidebarProps = {
  todos: TodoItem[];
  suggestions: TodoSuggestion[];
  agents?: Agent[];
  selectedAgentId?: string | null;
  onSelectAgent?: (id: string | null) => void;
  onLaunchAgent?: (todo: TodoItem) => void;
  onAddTodo?: (text: string, details?: string) => void;
  onToggleTodo?: (id: string) => void;
  onDeleteTodo?: (id: string) => void;
  onUpdateTodo?: (id: string, text: string) => void;
  processingTodoIds?: string[];
  onAcceptSuggestion?: (suggestion: TodoSuggestion) => void;
  onDismissSuggestion?: (id: string) => void;
  sessionId?: string;
  transcriptRefs?: string[];
  onRemoveTranscriptRef?: (index: number) => void;
  onSubmitTodoInput?: (text: string, refs: string[]) => void;
};

function SuggestionItem({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: TodoSuggestion;
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

function EditableTodoItem({
  todo,
  isProcessing,
  agent,
  onToggle,
  onDelete,
  onUpdate,
  onLaunchAgent,
  onSelectAgent,
}: {
  todo: TodoItem;
  isProcessing: boolean;
  agent?: Agent;
  onToggle?: () => void;
  onDelete?: () => void;
  onUpdate?: (text: string) => void;
  onLaunchAgent?: () => void;
  onSelectAgent?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function handleDoubleClick() {
    if (isProcessing || !onUpdate) return;
    setDraft(todo.text);
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== todo.text) onUpdate?.(trimmed);
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
          {todo.text}
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
          {todo.source === "ai" && !isProcessing && !editing && (
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
              aria-label="Delete todo"
            >
              <Trash2Icon className="size-3" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function RightSidebar({
  todos,
  suggestions,
  agents,
  selectedAgentId,
  onSelectAgent,
  onLaunchAgent,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onUpdateTodo,
  processingTodoIds = [],
  onAcceptSuggestion,
  onDismissSuggestion,
  sessionId,
  transcriptRefs = [],
  onRemoveTranscriptRef,
  onSubmitTodoInput,
}: RightSidebarProps) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const processingTodoIdSet = new Set(processingTodoIds);

  const { state: debriefState, generate: generateDebrief, canGenerate: canGenerateDebrief, preload: preloadDebrief } =
    useAgentsSummary(agents ?? []);

  useEffect(() => {
    if (!sessionId) return;
    void window.electronAPI.getAgentsSummary(sessionId).then((res) => {
      if (res.ok && res.summary) preloadDebrief(res.summary);
    });
  }, [sessionId, preloadDebrief]);

  const agentByTodoId = new Map<string, Agent>();
  for (const agent of agents ?? []) {
    if (!agentByTodoId.has(agent.todoId)) {
      agentByTodoId.set(agent.todoId, agent);
    }
  }

  const activeTodos: TodoItem[] = [];
  const completedTodos: TodoItem[] = [];
  let pendingInAgentsCount = 0;
  for (const todo of todos) {
    if (todo.completed) {
      completedTodos.push(todo);
      continue;
    }
    if (agentByTodoId.get(todo.id)?.status === "running") {
      pendingInAgentsCount += 1;
      continue;
    }
    activeTodos.push(todo);
  }

  const isViewingPast = !onSubmitTodoInput;
  const completedHaveAgents = completedTodos.some((t) => agentByTodoId.has(t.id));
  useEffect(() => {
    if (isViewingPast && completedHaveAgents) setCompletedOpen(true);
  }, [isViewingPast, completedHaveAgents]);

  const handleSubmit = useCallback(
    ({ text }: { text: string }) => {
      const refs = transcriptRefs;
      if (!text.trim() && refs.length === 0) return;
      onSubmitTodoInput?.(text.trim(), refs);
    },
    [transcriptRefs, onSubmitTodoInput]
  );

  const hasRefs = transcriptRefs.length > 0;

  return (
    <div className="w-full h-full shrink-0 border-l border-border flex flex-col min-h-0 bg-sidebar">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
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

        {/* Agents summary + list */}
        {agents && onSelectAgent && agents.length > 0 && (
          <>
            <AgentDebriefPanel
              state={debriefState}
              onGenerate={generateDebrief}
              canGenerate={canGenerateDebrief}
              onAddTodo={onAddTodo}
            />
            <AgentList
              agents={agents}
              selectedAgentId={selectedAgentId ?? null}
              onSelectAgent={onSelectAgent}
            />
            <Separator className="my-3" />
          </>
        )}

        {/* Active todos */}
        <div className="mb-3">
          <div className="sticky top-0 bg-sidebar z-10 -mx-3 px-3 py-1.5 flex items-center justify-between mb-1.5">
            <SectionLabel as="span">
              {pendingInAgentsCount > 0 ? `Todos · ${pendingInAgentsCount} in agents` : "Todos"}
            </SectionLabel>
            {(() => {
              const completedByAgent = activeTodos.filter(
                (t) => agentByTodoId.get(t.id)?.status === "completed"
              );
              if (completedByAgent.length === 0) return null;
              return (
                <button
                  type="button"
                  onClick={() => completedByAgent.forEach((t) => onToggleTodo?.(t.id))}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Complete all ({completedByAgent.length})
                </button>
              );
            })()}
          </div>
          {activeTodos.length > 0 ? (
            <ul className="space-y-px">
              {activeTodos.map((todo) => (
                <EditableTodoItem
                  key={todo.id}
                  todo={todo}
                  isProcessing={processingTodoIdSet.has(todo.id)}
                  agent={agentByTodoId.get(todo.id)}
                  onToggle={() => onToggleTodo?.(todo.id)}
                  onDelete={() => onDeleteTodo?.(todo.id)}
                  onUpdate={onUpdateTodo ? (text) => onUpdateTodo(todo.id, text) : undefined}
                  onLaunchAgent={onLaunchAgent ? () => onLaunchAgent(todo) : undefined}
                  onSelectAgent={onSelectAgent ?? undefined}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No active todos
            </p>
          )}
        </div>

        {/* Completed todos */}
        {completedTodos.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setCompletedOpen((prev) => !prev)}
              className="flex items-center gap-1 text-2xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              <ChevronDownIcon
                className={`size-3 transition-transform ${completedOpen ? "" : "-rotate-90"}`}
              />
              Completed ({completedTodos.length})
            </button>
            {completedOpen && (
              <ul className="mt-1.5 space-y-px">
                {completedTodos.map((todo) => {
                  const todoAgent = agentByTodoId.get(todo.id);
                  return (
                    <li key={todo.id} className="flex items-center gap-2 h-7 group px-1 -mx-1 rounded-sm hover:bg-muted/30 transition-colors">
                      <input
                        type="checkbox"
                        checked
                        onChange={() => onToggleTodo?.(todo.id)}
                        className="size-3 shrink-0 rounded-sm border-border accent-primary cursor-pointer"
                      />
                      {todoAgent && onSelectAgent ? (
                        <button
                          type="button"
                          onClick={() => onSelectAgent(todoAgent.id)}
                          className="text-xs text-muted-foreground/60 truncate flex-1 text-left line-through hover:text-muted-foreground transition-colors"
                        >
                          {todo.text}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground/60 truncate flex-1 line-through">
                          {todo.text}
                        </span>
                      )}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {todoAgent && onSelectAgent && (
                          <button
                            type="button"
                            onClick={() => onSelectAgent(todoAgent.id)}
                            className="p-0.5 text-muted-foreground hover:text-primary transition-colors"
                            aria-label="View agent results"
                          >
                            <HugeiconsIcon icon={WorkoutRunIcon} className="size-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteTodo?.(todo.id)}
                          className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                          aria-label="Delete todo"
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
      </div>

      {onSubmitTodoInput && (
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
              placeholder={hasRefs ? "What should these become?" : "Add a todo..."}
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
    </div>
  );
}
