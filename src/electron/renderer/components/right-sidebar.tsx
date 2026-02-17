import { useState, useCallback } from "react";
import type { TodoItem } from "../../../core/types";
import {
  Queue,
  QueueSection,
  QueueSectionTrigger,
  QueueSectionLabel,
  QueueSectionContent,
  QueueList,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
  QueueItemActions,
  QueueItemAction,
} from "@/components/ai-elements/queue";
import { CheckIcon, PlusIcon, TrashIcon } from "lucide-react";

type RightSidebarProps = {
  todos: TodoItem[];
  onAddTodo?: (text: string) => void;
  onToggleTodo?: (id: string) => void;
};

export function RightSidebar({ todos, onAddTodo, onToggleTodo }: RightSidebarProps) {
  const [input, setInput] = useState("");

  const activeTodos = todos.filter((t) => !t.completed);
  const completedTodos = todos.filter((t) => t.completed);

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
      <div className="px-3 pt-3 pb-2 shrink-0">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Todos
        </h2>

        {/* Add todo input */}
        <form onSubmit={handleSubmit} className="flex gap-1.5 mb-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add a todo..."
            className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-primary px-2 py-1.5 text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </form>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        <Queue className="border-none shadow-none px-0">
          {/* Active todos */}
          <QueueSection defaultOpen>
            <QueueSectionTrigger>
              <QueueSectionLabel
                count={activeTodos.length}
                label={activeTodos.length === 1 ? "Active" : "Active"}
              />
            </QueueSectionTrigger>
            <QueueSectionContent>
              <QueueList className="max-h-none">
                {activeTodos.length > 0 ? (
                  activeTodos.map((todo) => (
                    <QueueItem key={todo.id} className="flex-row items-start gap-2">
                      <QueueItemIndicator />
                      <QueueItemContent className="flex-1">
                        {todo.text}
                      </QueueItemContent>
                      <QueueItemActions>
                        <QueueItemAction
                          aria-label="Complete"
                          onClick={() => onToggleTodo?.(todo.id)}
                        >
                          <CheckIcon className="size-3" />
                        </QueueItemAction>
                      </QueueItemActions>
                    </QueueItem>
                  ))
                ) : (
                  <li className="px-3 py-2 text-xs text-muted-foreground italic">
                    No active todos
                  </li>
                )}
              </QueueList>
            </QueueSectionContent>
          </QueueSection>

          {/* Completed todos */}
          {completedTodos.length > 0 && (
            <QueueSection defaultOpen={false}>
              <QueueSectionTrigger>
                <QueueSectionLabel
                  count={completedTodos.length}
                  label="Completed"
                />
              </QueueSectionTrigger>
              <QueueSectionContent>
                <QueueList className="max-h-none">
                  {completedTodos.map((todo) => (
                    <QueueItem key={todo.id} className="flex-row items-start gap-2">
                      <QueueItemIndicator completed />
                      <QueueItemContent completed>
                        {todo.text}
                      </QueueItemContent>
                      {todo.source === "ai" && (
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">
                          AI
                        </span>
                      )}
                    </QueueItem>
                  ))}
                </QueueList>
              </QueueSectionContent>
            </QueueSection>
          )}
        </Queue>
      </div>
    </div>
  );
}
