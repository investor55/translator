import { useEffect, useRef } from "react";
import type { FinalSummary, Insight, TodoSuggestion } from "../../../core/types";

type UseSessionEventStreamParams = {
  onTodoSuggested: (suggestion: TodoSuggestion) => void;
  onInsightAdded: (insight: Insight) => void;
  onFinalSummaryReady?: (summary: FinalSummary) => void;
  onFinalSummaryError?: (error: string) => void;
};

export function useSessionEventStream({
  onTodoSuggested,
  onInsightAdded,
  onFinalSummaryReady,
  onFinalSummaryError,
}: UseSessionEventStreamParams) {
  const onTodoSuggestedRef = useRef(onTodoSuggested);
  const onInsightAddedRef = useRef(onInsightAdded);
  const onFinalSummaryReadyRef = useRef(onFinalSummaryReady);
  const onFinalSummaryErrorRef = useRef(onFinalSummaryError);

  useEffect(() => {
    onTodoSuggestedRef.current = onTodoSuggested;
    onInsightAddedRef.current = onInsightAdded;
    onFinalSummaryReadyRef.current = onFinalSummaryReady;
    onFinalSummaryErrorRef.current = onFinalSummaryError;
  }, [onInsightAdded, onTodoSuggested, onFinalSummaryReady, onFinalSummaryError]);

  useEffect(() => {
    const cleanups = [
      window.electronAPI.onTodoSuggested((suggestion) => {
        onTodoSuggestedRef.current(suggestion);
      }),
      window.electronAPI.onInsightAdded((insight) => {
        onInsightAddedRef.current(insight);
      }),
      window.electronAPI.onFinalSummaryReady((summary) => {
        onFinalSummaryReadyRef.current?.(summary);
      }),
      window.electronAPI.onFinalSummaryError((error) => {
        onFinalSummaryErrorRef.current?.(error);
      }),
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);
}
