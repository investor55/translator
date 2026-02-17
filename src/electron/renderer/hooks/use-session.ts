import { useEffect, useReducer, useCallback } from "react";
import type { UIState, TranscriptBlock, Summary, LanguageCode } from "../../../core/types";

type SessionState = {
  uiState: UIState | null;
  blocks: TranscriptBlock[];
  summary: Summary | null;
  cost: number;
  statusText: string;
  errorText: string;
  sessionActive: boolean;
};

type SessionAction =
  | { kind: "state-change"; state: UIState }
  | { kind: "block-added"; block: TranscriptBlock }
  | { kind: "block-updated"; block: TranscriptBlock }
  | { kind: "blocks-cleared" }
  | { kind: "summary-updated"; summary: Summary | null }
  | { kind: "cost-updated"; cost: number }
  | { kind: "status"; text: string }
  | { kind: "error"; text: string }
  | { kind: "session-started" }
  | { kind: "session-ended" };

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.kind) {
    case "state-change":
      return { ...state, uiState: action.state };
    case "block-added":
      return { ...state, blocks: [...state.blocks, action.block] };
    case "block-updated":
      return {
        ...state,
        blocks: state.blocks.map((b) =>
          b.id === action.block.id ? action.block : b
        ),
      };
    case "blocks-cleared":
      return { ...state, blocks: [], summary: null, cost: 0, statusText: "" };
    case "summary-updated":
      return { ...state, summary: action.summary };
    case "cost-updated":
      return { ...state, cost: action.cost };
    case "status":
      return { ...state, statusText: action.text };
    case "error":
      return { ...state, errorText: action.text };
    case "session-started":
      return { ...state, sessionActive: true };
    case "session-ended":
      return { ...state, sessionActive: false, uiState: null };
  }
}

const initialState: SessionState = {
  uiState: null,
  blocks: [],
  summary: null,
  cost: 0,
  statusText: "",
  errorText: "",
  sessionActive: false,
};

export function useSession(sourceLang: LanguageCode, targetLang: LanguageCode, active: boolean) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

  useEffect(() => {
    if (!active) return;

    const api = window.electronAPI;
    const cleanups: (() => void)[] = [];

    cleanups.push(api.onStateChange((s) => dispatch({ kind: "state-change", state: s })));
    cleanups.push(api.onBlockAdded((b) => dispatch({ kind: "block-added", block: b })));
    cleanups.push(api.onBlockUpdated((b) => dispatch({ kind: "block-updated", block: b })));
    cleanups.push(api.onBlocksCleared(() => dispatch({ kind: "blocks-cleared" })));
    cleanups.push(api.onSummaryUpdated((s) => dispatch({ kind: "summary-updated", summary: s })));
    cleanups.push(api.onCostUpdated((c) => dispatch({ kind: "cost-updated", cost: c })));
    cleanups.push(api.onStatus((t) => dispatch({ kind: "status", text: t })));
    cleanups.push(api.onError((t) => dispatch({ kind: "error", text: t })));

    api.startSession(sourceLang, targetLang).then(async (result) => {
      if (result.ok) {
        dispatch({ kind: "session-started" });
        await api.startRecording();
      } else {
        dispatch({ kind: "error", text: result.error ?? "Failed to start session" });
      }
    });

    return () => {
      cleanups.forEach((fn) => fn());
      api.shutdownSession();
      dispatch({ kind: "session-ended" });
    };
  }, [sourceLang, targetLang, active]);

  const toggleRecording = useCallback(async () => {
    const result = await window.electronAPI.toggleRecording();
    if (!result.ok) {
      dispatch({ kind: "error", text: result.error ?? "Failed to toggle recording" });
    }
  }, []);

  return { ...state, toggleRecording };
}
