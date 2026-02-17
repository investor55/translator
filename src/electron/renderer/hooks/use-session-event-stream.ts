import { useEffect } from "react";
import type { Insight, TodoSuggestion } from "../../../core/types";

type UseSessionEventStreamParams = {
  statusText: string;
  setScanFeedback: (feedback: string) => void;
  setScanningTodos: (value: boolean) => void;
  onTodoSuggested: (suggestion: TodoSuggestion) => void;
  onInsightAdded: (insight: Insight) => void;
};

export function useSessionEventStream({
  statusText,
  setScanFeedback,
  setScanningTodos,
  onTodoSuggested,
  onInsightAdded,
}: UseSessionEventStreamParams) {
  useEffect(() => {
    const normalizedStatus = statusText?.trim();
    if (!normalizedStatus) return;
    if (normalizedStatus.toLowerCase().startsWith("todo scan")) {
      setScanFeedback(normalizedStatus);
      if (
        normalizedStatus.toLowerCase().includes("complete")
        || normalizedStatus.toLowerCase().includes("failed")
        || normalizedStatus.toLowerCase().includes("skipped")
      ) {
        setScanningTodos(false);
      }
    }
  }, [setScanFeedback, setScanningTodos, statusText]);

  useEffect(() => {
    const cleanups = [
      window.electronAPI.onTodoSuggested((suggestion) => {
        onTodoSuggested(suggestion);
      }),
      window.electronAPI.onInsightAdded((insight) => {
        onInsightAdded(insight);
      }),
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [onInsightAdded, onTodoSuggested]);
}
