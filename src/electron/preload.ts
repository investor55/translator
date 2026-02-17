import { contextBridge, ipcRenderer } from "electron/renderer";
import type {
  Language,
  UIState,
  TranscriptBlock,
  Summary,
  LanguageCode,
  Device,
  TodoItem,
  TodoSuggestion,
  Insight,
  SessionMeta,
  Agent,
  AgentStep,
  AppConfigOverrides,
} from "../core/types";

export type ElectronAPI = {
  getLanguages: () => Promise<Language[]>;
  startSession: (sourceLang: LanguageCode, targetLang: LanguageCode, appConfig?: AppConfigOverrides) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  resumeSession: (sessionId: string, appConfig?: AppConfigOverrides) => Promise<{ ok: boolean; sessionId?: string; blocks?: TranscriptBlock[]; todos?: TodoItem[]; insights?: Insight[]; agents?: Agent[]; error?: string }>;
  startRecording: () => Promise<{ ok: boolean; error?: string }>;
  stopRecording: () => Promise<{ ok: boolean; error?: string }>;
  toggleRecording: () => Promise<{ ok: boolean; recording?: boolean; error?: string }>;
  toggleMic: () => Promise<{ ok: boolean; micEnabled?: boolean; captureInRenderer?: boolean; error?: string }>;
  sendMicAudio: (data: ArrayBuffer) => void;
  toggleTranslation: () => Promise<{ ok: boolean; enabled?: boolean; error?: string }>;
  listMicDevices: () => Promise<Device[]>;
  shutdownSession: () => Promise<{ ok: boolean }>;

  getTodos: () => Promise<TodoItem[]>;
  addTodo: (todo: TodoItem) => Promise<{ ok: boolean }>;
  toggleTodo: (id: string) => Promise<{ ok: boolean; error?: string }>;
  getSessions: (limit?: number) => Promise<SessionMeta[]>;
  getSessionBlocks: (sessionId: string) => Promise<TranscriptBlock[]>;
  deleteSession: (id: string) => Promise<{ ok: boolean }>;
  getInsights: (limit?: number) => Promise<Insight[]>;
  getSessionTodos: (sessionId: string) => Promise<TodoItem[]>;
  getSessionInsights: (sessionId: string) => Promise<Insight[]>;

  launchAgent: (todoId: string, task: string) => Promise<{ ok: boolean; agent?: Agent; error?: string }>;
  followUpAgent: (agentId: string, question: string) => Promise<{ ok: boolean; error?: string }>;
  followUpAgentInSession: (sessionId: string, agentId: string, question: string, appConfig?: AppConfigOverrides) => Promise<{ ok: boolean; error?: string }>;
  cancelAgent: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  getAgents: () => Promise<Agent[]>;
  getSessionAgents: (sessionId: string) => Promise<Agent[]>;

  onStateChange: (callback: (state: UIState) => void) => () => void;
  onBlockAdded: (callback: (block: TranscriptBlock) => void) => () => void;
  onBlockUpdated: (callback: (block: TranscriptBlock) => void) => () => void;
  onBlocksCleared: (callback: () => void) => () => void;
  onSummaryUpdated: (callback: (summary: Summary | null) => void) => () => void;
  onCostUpdated: (callback: (cost: number) => void) => () => void;
  onStatus: (callback: (text: string) => void) => () => void;
  onError: (callback: (text: string) => void) => () => void;
  onTodoAdded: (callback: (todo: TodoItem) => void) => () => void;
  onTodoSuggested: (callback: (suggestion: TodoSuggestion) => void) => () => void;
  onInsightAdded: (callback: (insight: Insight) => void) => () => void;
  onAgentStarted: (callback: (agent: Agent) => void) => () => void;
  onAgentStep: (callback: (agentId: string, step: AgentStep) => void) => () => void;
  onAgentCompleted: (callback: (agentId: string, result: string) => void) => () => void;
  onAgentFailed: (callback: (agentId: string, error: string) => void) => () => void;
};

function createListener<T>(channel: string) {
  return (callback: (data: T) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

const api: ElectronAPI = {
  getLanguages: () => ipcRenderer.invoke("get-languages"),
  startSession: (sourceLang, targetLang, appConfig) => ipcRenderer.invoke("start-session", sourceLang, targetLang, appConfig),
  resumeSession: (sessionId, appConfig) => ipcRenderer.invoke("resume-session", sessionId, appConfig),
  startRecording: () => ipcRenderer.invoke("start-recording"),
  stopRecording: () => ipcRenderer.invoke("stop-recording"),
  toggleRecording: () => ipcRenderer.invoke("toggle-recording"),
  toggleMic: () => ipcRenderer.invoke("toggle-mic"),
  sendMicAudio: (data) => ipcRenderer.send("mic-audio-data", data),
  toggleTranslation: () => ipcRenderer.invoke("toggle-translation"),
  listMicDevices: () => ipcRenderer.invoke("list-mic-devices"),
  shutdownSession: () => ipcRenderer.invoke("shutdown-session"),

  getTodos: () => ipcRenderer.invoke("get-todos"),
  addTodo: (todo) => ipcRenderer.invoke("add-todo", todo),
  toggleTodo: (id) => ipcRenderer.invoke("toggle-todo", id),
  getSessions: (limit) => ipcRenderer.invoke("get-sessions", limit),
  getSessionBlocks: (sessionId) => ipcRenderer.invoke("get-session-blocks", sessionId),
  deleteSession: (id) => ipcRenderer.invoke("delete-session", id),
  getInsights: (limit) => ipcRenderer.invoke("get-insights", limit),
  getSessionTodos: (sessionId) => ipcRenderer.invoke("get-session-todos", sessionId),
  getSessionInsights: (sessionId) => ipcRenderer.invoke("get-session-insights", sessionId),

  launchAgent: (todoId, task) => ipcRenderer.invoke("launch-agent", todoId, task),
  followUpAgent: (agentId, question) => ipcRenderer.invoke("follow-up-agent", agentId, question),
  followUpAgentInSession: (sessionId, agentId, question, appConfig) => ipcRenderer.invoke("follow-up-agent-in-session", sessionId, agentId, question, appConfig),
  cancelAgent: (agentId) => ipcRenderer.invoke("cancel-agent", agentId),
  getAgents: () => ipcRenderer.invoke("get-agents"),
  getSessionAgents: (sessionId) => ipcRenderer.invoke("get-session-agents", sessionId),

  onStateChange: createListener<UIState>("session:state-change"),
  onBlockAdded: createListener<TranscriptBlock>("session:block-added"),
  onBlockUpdated: createListener<TranscriptBlock>("session:block-updated"),
  onBlocksCleared: createListener<void>("session:blocks-cleared"),
  onSummaryUpdated: createListener<Summary | null>("session:summary-updated"),
  onCostUpdated: createListener<number>("session:cost-updated"),
  onStatus: createListener<string>("session:status"),
  onError: createListener<string>("session:error"),
  onTodoAdded: createListener<TodoItem>("session:todo-added"),
  onTodoSuggested: createListener<TodoSuggestion>("session:todo-suggested"),
  onInsightAdded: createListener<Insight>("session:insight-added"),
  onAgentStarted: createListener<Agent>("session:agent-started"),
  onAgentStep: (callback: (agentId: string, step: AgentStep) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, agentId: string, step: AgentStep) => callback(agentId, step);
    ipcRenderer.on("session:agent-step", handler);
    return () => ipcRenderer.removeListener("session:agent-step", handler);
  },
  onAgentCompleted: (callback: (agentId: string, result: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, agentId: string, result: string) => callback(agentId, result);
    ipcRenderer.on("session:agent-completed", handler);
    return () => ipcRenderer.removeListener("session:agent-completed", handler);
  },
  onAgentFailed: (callback: (agentId: string, error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, agentId: string, error: string) => callback(agentId, error);
    ipcRenderer.on("session:agent-failed", handler);
    return () => ipcRenderer.removeListener("session:agent-failed", handler);
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
