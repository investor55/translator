import { useEffect, useRef } from "react";
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
  const onTodoSuggestedRef = useRef(onTodoSuggested);
  const onInsightAddedRef = useRef(onInsightAdded);

  useEffect(() => {
    onTodoSuggestedRef.current = onTodoSuggested;
    onInsightAddedRef.current = onInsightAdded;
  }, [onInsightAdded, onTodoSuggested]);

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
        onTodoSuggestedRef.current(suggestion);
      }),
      window.electronAPI.onInsightAdded((insight) => {
        onInsightAddedRef.current(insight);
      }),
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);
}
