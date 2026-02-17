import { useEffect, useRef } from "react";
import type { Insight, TodoSuggestion } from "../../../core/types";

type UseSessionEventStreamParams = {
  onTodoSuggested: (suggestion: TodoSuggestion) => void;
  onInsightAdded: (insight: Insight) => void;
};

export function useSessionEventStream({
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
