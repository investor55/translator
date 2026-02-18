import { useState, useEffect, useCallback } from "react";
import type { TodoItem, TodoSuggestion, Agent } from "../../../core/types";
import {
  PlusIcon,
  ChevronDownIcon,
  CheckIcon,
  XIcon,
  LoaderCircleIcon,
  PlayIcon,
  Trash2Icon,
  ZapIcon,
  SparklesIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AgentList } from "./agent-list";
import { AgentDebriefPanel } from "./agent-debrief-panel";
import { useAgentsSummary } from "../hooks/use-agents-summary";
import { Separator } from "@/components/ui/separator";

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
  processingTodoIds?: string[];
  onAcceptSuggestion?: (suggestion: TodoSuggestion) => void;
  onDismissSuggestion?: (id: string) => void;
  sessionId?: string;
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

    // Start progress from current remaining fraction
    setProgress((remaining / SUGGESTION_TTL_MS) * 100);

    // Tick the progress bar down every 100ms
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

function ContextDot({ details }: { details?: string }) {
  if (!details?.trim()) return null;
  return (
    <span
      className="shrink-0 size-1 rounded-full bg-muted-foreground/40"
      title={details.trim()}
    />
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
  processingTodoIds = [],
  onAcceptSuggestion,
  onDismissSuggestion,
  sessionId,
}: RightSidebarProps) {
  const [input, setInput] = useState("");
  const [completedOpen, setCompletedOpen] = useState(false);
  const processingTodoIdSet = new Set(processingTodoIds);

  const { state: debriefState, generate: generateDebrief, canGenerate: canGenerateDebrief, preload: preloadDebrief } =
    useAgentsSummary(agents ?? []);

  // Pre-populate debrief from DB for past sessions
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

  // Auto-expand completed section when viewing past sessions with agent results
  const isViewingPast = !onAddTodo;
  const completedHaveAgents = completedTodos.some((t) => agentByTodoId.has(t.id));
  useEffect(() => {
    if (isViewingPast && completedHaveAgents) setCompletedOpen(true);
  }, [isViewingPast, completedHaveAgents]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;
      onAddTodo?.(text);
      setInput("");
    },
    [input, onAddTodo]
  );

  return (
    <div className="w-full h-full shrink-0 border-l border-border flex flex-col min-h-0 bg-sidebar">
      {onAddTodo && (
        <div className="px-3 pt-2.5 pb-2 shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-1.5">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Add a todo..."
              className="flex-1 h-7"
            />
            <Button
              type="submit"
              size="icon-sm"
              disabled={!input.trim()}
            >
              <PlusIcon className="size-3.5" />
            </Button>
          </form>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {/* AI Suggestions */}
        {suggestions.length > 0 && (
          <div className="mb-3">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Suggested
            </span>
            <ul className="mt-1.5 space-y-1">
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

        {/* Agents */}
        {agents && onSelectAgent && agents.length > 0 && (
          <>
            <AgentList
              agents={agents}
              selectedAgentId={selectedAgentId ?? null}
              onSelectAgent={onSelectAgent}
              onGenerateDebrief={generateDebrief}
              canGenerateDebrief={canGenerateDebrief}
              isDebriefLoading={debriefState.kind === "loading"}
            />
            <AgentDebriefPanel
              state={debriefState}
              onGenerate={generateDebrief}
              canGenerate={canGenerateDebrief}
              onAddTodo={onAddTodo}
            />
            <Separator className="my-3" />
          </>
        )}

        {/* Active todos */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {pendingInAgentsCount > 0 ? `Todos · ${pendingInAgentsCount} in agents` : "Todos"}
            </span>
          </div>
          {activeTodos.length > 0 ? (
            <ul className="space-y-px">
              {activeTodos.map((todo) => {
                const isProcessing = processingTodoIdSet.has(todo.id);
                return (
                  <li key={todo.id} className="flex items-center gap-2 h-7 group px-1 -mx-1 rounded-sm hover:bg-muted/30 transition-colors">
                    {isProcessing ? (
                      <LoaderCircleIcon className="size-3 shrink-0 text-muted-foreground animate-spin" />
                    ) : (
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => onToggleTodo?.(todo.id)}
                        className="size-3 shrink-0 rounded-sm border-border accent-primary cursor-pointer"
                      />
                    )}
                    <span className={`text-xs truncate flex-1 ${isProcessing ? "text-muted-foreground italic" : "text-foreground"}`}>
                      {todo.text}
                    </span>
                    <ContextDot details={todo.details} />
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {!isProcessing && onLaunchAgent && (
                        <button
                          type="button"
                          onClick={() => onLaunchAgent(todo)}
                          className="p-0.5 text-muted-foreground hover:text-primary transition-colors"
                          aria-label="Run with agent"
                        >
                          <PlayIcon className="size-3" />
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
                    {todo.source === "ai" && !isProcessing && (
                      <ZapIcon className="size-3 text-muted-foreground/40 shrink-0 group-hover:hidden" />
                    )}
                  </li>
                );
              })}
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
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
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
                            <SparklesIcon className="size-3" />
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
    </div>
  );
}
