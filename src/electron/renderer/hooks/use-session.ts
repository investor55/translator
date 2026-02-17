import { useEffect, useReducer, useCallback, useRef } from "react";
import type { UIState, TranscriptBlock, Summary, LanguageCode, TodoItem, Insight, Agent, AppConfig } from "../../../core/types";

type SessionState = {
  sessionId: string | null;
  uiState: UIState | null;
  blocks: TranscriptBlock[];
  summary: Summary | null;
  rollingKeyPoints: string[];
  cost: number;
  statusText: string;
  errorText: string;
  sessionActive: boolean;
};

type ResumeData = {
  sessionId: string;
  blocks: TranscriptBlock[];
  todos: TodoItem[];
  insights: Insight[];
  agents: Agent[];
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
  | { kind: "session-started"; sessionId: string }
  | { kind: "session-resumed"; data: ResumeData }
  | { kind: "session-ended" }
  | { kind: "session-viewed"; sessionId: string; blocks: TranscriptBlock[]; keyPoints: string[] };

function sortBlocks(blocks: TranscriptBlock[]): TranscriptBlock[] {
  return [...blocks].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id - b.id;
  });
}

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.kind) {
    case "state-change":
      return { ...state, uiState: action.state };
    case "block-added":
      return { ...state, blocks: sortBlocks([...state.blocks, action.block]) };
    case "block-updated":
      return {
        ...state,
        blocks: sortBlocks(state.blocks.map((b) =>
          b.id === action.block.id ? action.block : b
        )),
      };
    case "blocks-cleared":
      return { ...state, blocks: [], summary: null, rollingKeyPoints: [], cost: 0, statusText: "" };
    case "summary-updated":
      return {
        ...state,
        summary: action.summary,
        rollingKeyPoints: action.summary
          ? [...state.rollingKeyPoints, ...action.summary.keyPoints]
          : state.rollingKeyPoints,
      };
    case "cost-updated":
      return { ...state, cost: action.cost };
    case "status":
      return { ...state, statusText: action.text };
    case "error":
      return { ...state, errorText: action.text };
    case "session-started":
      return {
        ...state,
        sessionActive: true,
        sessionId: action.sessionId,
        blocks: [],
        summary: null,
        rollingKeyPoints: [],
        cost: 0,
        statusText: "",
        errorText: "",
      };
    case "session-resumed": {
      const keyPoints = action.data.insights
        .filter((i) => i.kind === "key-point")
        .map((i) => i.text);
      return {
        ...state,
        sessionActive: true,
        sessionId: action.data.sessionId,
        blocks: sortBlocks(action.data.blocks),
        rollingKeyPoints: keyPoints,
      };
    }
    case "session-ended":
      return { ...state, sessionActive: false, uiState: null, statusText: "", errorText: "" };
    case "session-viewed":
      return {
        ...state,
        sessionId: action.sessionId,
        blocks: sortBlocks(action.blocks),
        rollingKeyPoints: action.keyPoints,
        sessionActive: false,
        uiState: null,
        summary: null,
        cost: 0,
        statusText: "",
        errorText: "",
      };
  }
}

const initialState: SessionState = {
  sessionId: null,
  uiState: null,
  blocks: [],
  summary: null,
  rollingKeyPoints: [],
  cost: 0,
  statusText: "",
  errorText: "",
  sessionActive: false,
};

export type { ResumeData };

export type SessionOptions = {
  onResumed?: (data: ResumeData) => void;
};

export function useSession(
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  active: boolean,
  appConfig: AppConfig,
  resumeSessionId: string | null = null,
  options: SessionOptions = {},
) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  const onResumedRef = useRef(options.onResumed);
  const appConfigRef = useRef(appConfig);
  onResumedRef.current = options.onResumed;
  appConfigRef.current = appConfig;

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

    if (resumeSessionId) {
      api.resumeSession(resumeSessionId, appConfigRef.current).then((result) => {
        if (result.ok && result.sessionId) {
          const data: ResumeData = {
            sessionId: result.sessionId,
            blocks: result.blocks ?? [],
            todos: result.todos ?? [],
            insights: result.insights ?? [],
            agents: result.agents ?? [],
          };
          dispatch({ kind: "session-resumed", data });
          onResumedRef.current?.(data);
        } else {
          dispatch({ kind: "error", text: result.error ?? "Failed to resume session" });
        }
      });
    } else {
      api.startSession(sourceLang, targetLang, appConfigRef.current).then(async (result) => {
        if (result.ok && result.sessionId) {
          dispatch({ kind: "session-started", sessionId: result.sessionId });
          await api.startRecording();
        } else {
          dispatch({ kind: "error", text: result.error ?? "Failed to start session" });
        }
      });
    }

    return () => {
      cleanups.forEach((fn) => fn());
      api.shutdownSession();
      dispatch({ kind: "session-ended" });
    };
  }, [sourceLang, targetLang, active, resumeSessionId]);

  const toggleRecording = useCallback(async () => {
    const result = await window.electronAPI.toggleRecording();
    if (!result.ok) {
      dispatch({ kind: "error", text: result.error ?? "Failed to toggle recording" });
    }
  }, []);

  const viewSession = useCallback(async (sessionId: string) => {
    const api = window.electronAPI;
    const [blocks, insights] = await Promise.all([
      api.getSessionBlocks(sessionId),
      api.getSessionInsights(sessionId),
    ]);
    const keyPoints = insights
      .filter((i: Insight) => i.kind === "key-point")
      .map((i: Insight) => i.text);
    dispatch({ kind: "session-viewed", sessionId, blocks, keyPoints });
  }, []);

  return { ...state, toggleRecording, viewSession };
}
