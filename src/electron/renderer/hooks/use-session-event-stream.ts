import { useEffect, useRef } from "react";
import type { FinalSummary, TaskSuggestion } from "../../../core/types";

type UseSessionEventStreamParams = {
  onTaskSuggested: (suggestion: TaskSuggestion) => void;
  onFinalSummaryReady?: (summary: FinalSummary) => void;
  onFinalSummaryError?: (error: string) => void;
};

export function useSessionEventStream({
  onTaskSuggested,
  onFinalSummaryReady,
  onFinalSummaryError,
}: UseSessionEventStreamParams) {
  const onTaskSuggestedRef = useRef(onTaskSuggested);
  const onFinalSummaryReadyRef = useRef(onFinalSummaryReady);
  const onFinalSummaryErrorRef = useRef(onFinalSummaryError);

  useEffect(() => {
    onTaskSuggestedRef.current = onTaskSuggested;
    onFinalSummaryReadyRef.current = onFinalSummaryReady;
    onFinalSummaryErrorRef.current = onFinalSummaryError;
  }, [onTaskSuggested, onFinalSummaryReady, onFinalSummaryError]);

  useEffect(() => {
    const cleanups = [
      window.electronAPI.onTaskSuggested((suggestion) => {
        onTaskSuggestedRef.current(suggestion);
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
