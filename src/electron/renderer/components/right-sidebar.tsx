import { useState, useEffect, useCallback } from "react";
import type { TodoItem, TodoSuggestion, Agent } from "../../../core/types";
import { PlusIcon, ChevronDownIcon, CheckIcon, XIcon, SearchIcon, LoaderCircleIcon } from "lucide-react";
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
  onLaunchAgent?: (todoId: string, task: string) => void;
  onAddTodo?: (text: string) => void;
  onToggleTodo?: (id: string) => void;
  onScanTodos?: () => void;
  scanningTodos?: boolean;
  scanFeedback?: string;
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

export function RightSidebar({
  todos,
  suggestions,
  agents,
  selectedAgentId,
  onSelectAgent,
  onLaunchAgent,
  onAddTodo,
  onToggleTodo,
  onScanTodos,
  scanningTodos = false,
  scanFeedback,
  onAcceptSuggestion,
  onDismissSuggestion,
}: RightSidebarProps) {
  const [input, setInput] = useState("");
  const [completedOpen, setCompletedOpen] = useState(false);

  const activeTodos = todos.filter((t) => !t.completed);
  const completedTodos = todos.filter((t) => t.completed);
  const agentTodoIds = new Set(agents?.map((a) => a.todoId) ?? []);

  // Auto-expand completed section when viewing past sessions with agent results
  const isViewingPast = !onAddTodo;
  const completedHaveAgents = completedTodos.some((t) => agentTodoIds.has(t.id));
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
    <div className="w-[300px] shrink-0 border-l border-border flex flex-col min-h-0 bg-sidebar">
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
              {onScanTodos && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={onScanTodos}
                  disabled={scanningTodos}
                >
                  {scanningTodos ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin" />
                  ) : (
                    "Scan"
                  )}
                </Button>
              )}
            </form>
            {scanFeedback && (
              <p className="mt-1 text-[11px] text-muted-foreground">{scanFeedback}</p>
            )}
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
          {activeTodos.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {activeTodos.map((todo) => {
                const hasAgent = agentTodoIds.has(todo.id);
                const todoAgent = agents?.find((a) => a.todoId === todo.id);
                return (
                  <li key={todo.id} className="flex items-start gap-2 py-1 group">
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => onToggleTodo?.(todo.id)}
                      className="mt-0.5 size-3.5 rounded border-input accent-primary cursor-pointer shrink-0"
                    />
                    <span className="text-xs text-foreground leading-relaxed flex-1">
                      {todo.text}
                    </span>
                    {hasAgent && todoAgent ? (
                      <button
                        type="button"
                        onClick={() => onSelectAgent?.(todoAgent.id)}
                        className="shrink-0 rounded-none p-0.5 text-primary hover:bg-primary/10 transition-colors"
                        aria-label="View agent"
                      >
                        {todoAgent.status === "running" ? (
                          <LoaderCircleIcon className="size-3.5 animate-spin" />
                        ) : (
                          <SearchIcon className="size-3.5" />
                        )}
                      </button>
                    ) : onLaunchAgent ? (
                      <button
                        type="button"
                        onClick={() => onLaunchAgent(todo.id, todo.text)}
                        className="shrink-0 rounded-none p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all"
                        aria-label="Research this todo"
                      >
                        <SearchIcon className="size-3.5" />
                      </button>
                    ) : null}
                    {todo.source === "ai" && !hasAgent && (
                      <span className="text-[11px] text-muted-foreground bg-muted px-1 py-0.5 rounded-none shrink-0 leading-none">
                        AI
                      </span>
                    )}
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
                  const todoAgent = agents?.find((a) => a.todoId === todo.id);
                  return (
                    <li key={todo.id} className="flex items-start gap-2 py-1 group">
                      <input
                        type="checkbox"
                        checked
                        onChange={() => onToggleTodo?.(todo.id)}
                        className="mt-0.5 size-3.5 rounded border-input accent-primary cursor-pointer shrink-0"
                      />
                      {todoAgent && onSelectAgent ? (
                        <button
                          type="button"
                          onClick={() => onSelectAgent(todoAgent.id)}
                          className="text-xs text-muted-foreground leading-relaxed flex-1 text-left hover:text-foreground transition-colors cursor-pointer"
                        >
                          {todo.text}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground line-through leading-relaxed flex-1">
                          {todo.text}
                        </span>
                      )}
                      {todoAgent && onSelectAgent && (
                        <button
                          type="button"
                          onClick={() => onSelectAgent(todoAgent.id)}
                          className="shrink-0 rounded-none p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all"
                          aria-label="View agent results"
                        >
                          <SearchIcon className="size-3.5" />
                        </button>
                      )}
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
