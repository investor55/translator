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
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AgentList } from "./agent-list";

const SUGGESTION_TTL_MS = 30_000;

type RightSidebarProps = {
  todos: TodoItem[];
  suggestions: TodoSuggestion[];
  agents?: Agent[];
  selectedAgentId?: string | null;
  onSelectAgent?: (id: string | null) => void;
  onLaunchAgent?: (todo: TodoItem) => void;
  onAddTodo?: (text: string) => void;
  onToggleTodo?: (id: string) => void;
  onDeleteTodo?: (id: string) => void;
  processingTodoIds?: string[];
  onAcceptSuggestion?: (suggestion: TodoSuggestion) => void;
  onDismissSuggestion?: (id: string) => void;
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
      className="relative overflow-hidden rounded-none bg-primary/5 border border-primary/10 transition-opacity duration-500"
      style={{ opacity }}
    >
      <div className="flex items-start gap-2 py-1.5 px-2 relative z-10">
        <span className="text-xs text-foreground leading-relaxed flex-1">
          {suggestion.text}
        </span>
        <button
          type="button"
          onClick={onAccept}
          className="shrink-0 rounded-none p-0.5 text-primary hover:bg-primary/10 transition-colors"
          aria-label="Accept suggestion"
        >
          <CheckIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-none p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Dismiss suggestion"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      {/* Countdown progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary/5">
        <div
          className="h-full bg-primary/30 transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </li>
  );
}

function TodoContextPanel({ details }: { details?: string }) {
  const contextText = details?.trim();
  if (!contextText) return null;

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground transition-colors">
        Context
      </summary>
      <div className="mt-1 max-h-28 overflow-y-auto rounded-none border border-border/60 bg-muted/20 px-1.5 py-1">
        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
          {contextText}
        </p>
      </div>
    </details>
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
}: RightSidebarProps) {
  const [input, setInput] = useState("");
  const [completedOpen, setCompletedOpen] = useState(false);
  const processingTodoIdSet = new Set(processingTodoIds);

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
    if (agentByTodoId.has(todo.id)) {
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
      <div className="px-3 pt-2.5 pb-2 shrink-0">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Todos
        </h2>

        {onAddTodo && (
          <div className="mb-3">
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
      </div>

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
        {agents && onSelectAgent && (
          <AgentList
            agents={agents}
            selectedAgentId={selectedAgentId ?? null}
            onSelectAgent={onSelectAgent}
          />
        )}

        {/* Active todos */}
        <div className="mb-3">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Active ({activeTodos.length})
          </span>
          {pendingInAgentsCount > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {pendingInAgentsCount} pending in agents
            </p>
          )}
          {activeTodos.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {activeTodos.map((todo) => {
                const isProcessing = processingTodoIdSet.has(todo.id);
                return (
                  <li key={todo.id} className="py-1 group">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => onToggleTodo?.(todo.id)}
                        disabled={isProcessing}
                        className="mt-0.5 size-3.5 rounded border-input accent-primary cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <div className="min-w-0 flex-1">
                        <span
                          className={`text-xs leading-relaxed ${isProcessing ? "text-muted-foreground italic" : "text-foreground"}`}
                        >
                          {todo.text}
                        </span>
                        <TodoContextPanel details={todo.details} />
                      </div>
                      {isProcessing ? (
                        <span className="shrink-0 rounded-none p-0.5 text-muted-foreground" aria-label="Processing todo">
                          <LoaderCircleIcon className="size-3.5 animate-spin" />
                        </span>
                      ) : onLaunchAgent ? (
                        <button
                          type="button"
                          onClick={() => onLaunchAgent(todo)}
                          className="shrink-0 rounded-none p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all"
                          aria-label="Run with agent"
                        >
                          <PlayIcon className="size-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onDeleteTodo?.(todo.id)}
                        className="shrink-0 rounded-none p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
                        aria-label="Delete todo"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                      {todo.source === "ai" && !isProcessing && (
                        <span className="shrink-0 p-0.5 flex items-center">
                          <ZapIcon className="size-3 text-muted-foreground/60" />
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground italic mt-1.5">
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
              <ul className="mt-1.5 space-y-1">
                {completedTodos.map((todo) => {
                  const todoAgent = agentByTodoId.get(todo.id);
                  return (
                    <li key={todo.id} className="py-1 group">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked
                          onChange={() => onToggleTodo?.(todo.id)}
                          className="mt-0.5 size-3.5 rounded border-input accent-primary cursor-pointer shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          {todoAgent && onSelectAgent ? (
                            <button
                              type="button"
                              onClick={() => onSelectAgent(todoAgent.id)}
                              className="text-xs text-muted-foreground leading-relaxed text-left hover:text-foreground transition-colors cursor-pointer"
                            >
                              {todo.text}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground line-through leading-relaxed">
                              {todo.text}
                            </span>
                          )}
                          <TodoContextPanel details={todo.details} />
                        </div>
                        {todoAgent && onSelectAgent && (
                          <button
                            type="button"
                            onClick={() => onSelectAgent(todoAgent.id)}
                            className="shrink-0 rounded-none p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all"
                            aria-label="View agent results"
                          >
                            <SparklesIcon className="size-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteTodo?.(todo.id)}
                          className="shrink-0 rounded-none p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
                          aria-label="Delete todo"
                        >
                          <Trash2Icon className="size-3.5" />
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
