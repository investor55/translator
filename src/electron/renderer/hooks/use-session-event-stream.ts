import { useEffect, useRef } from "react";
import type { FinalSummary, Insight, TaskSuggestion } from "../../../core/types";

type UseSessionEventStreamParams = {
  onTaskSuggested: (suggestion: TaskSuggestion) => void;
  onInsightAdded: (insight: Insight) => void;
  onFinalSummaryReady?: (summary: FinalSummary) => void;
  onFinalSummaryError?: (error: string) => void;
};

export function useSessionEventStream({
  onTaskSuggested,
  onInsightAdded,
  onFinalSummaryReady,
  onFinalSummaryError,
}: UseSessionEventStreamParams) {
  const onTaskSuggestedRef = useRef(onTaskSuggested);
  const onInsightAddedRef = useRef(onInsightAdded);
  const onFinalSummaryReadyRef = useRef(onFinalSummaryReady);
  const onFinalSummaryErrorRef = useRef(onFinalSummaryError);

  useEffect(() => {
    onTaskSuggestedRef.current = onTaskSuggested;
    onInsightAddedRef.current = onInsightAdded;
    onFinalSummaryReadyRef.current = onFinalSummaryReady;
    onFinalSummaryErrorRef.current = onFinalSummaryError;
  }, [onInsightAdded, onTaskSuggested, onFinalSummaryReady, onFinalSummaryError]);

  useEffect(() => {
    const cleanups = [
      window.electronAPI.onTaskSuggested((suggestion) => {
        onTaskSuggestedRef.current(suggestion);
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
