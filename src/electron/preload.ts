import { contextBridge, ipcRenderer } from "electron/renderer";
import type { Language, UIState, TranscriptBlock, Summary, LanguageCode } from "../core/types";

export type ElectronAPI = {
  getLanguages: () => Promise<Language[]>;
  startSession: (sourceLang: LanguageCode, targetLang: LanguageCode) => Promise<{ ok: boolean; error?: string }>;
  startRecording: () => Promise<{ ok: boolean; error?: string }>;
  stopRecording: () => Promise<{ ok: boolean; error?: string }>;
  toggleRecording: () => Promise<{ ok: boolean; recording?: boolean; error?: string }>;
  shutdownSession: () => Promise<{ ok: boolean }>;

  onStateChange: (callback: (state: UIState) => void) => () => void;
  onBlockAdded: (callback: (block: TranscriptBlock) => void) => () => void;
  onBlockUpdated: (callback: (block: TranscriptBlock) => void) => () => void;
  onBlocksCleared: (callback: () => void) => () => void;
  onSummaryUpdated: (callback: (summary: Summary | null) => void) => () => void;
  onCostUpdated: (callback: (cost: number) => void) => () => void;
  onStatus: (callback: (text: string) => void) => () => void;
  onError: (callback: (text: string) => void) => () => void;
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
  startSession: (sourceLang, targetLang) => ipcRenderer.invoke("start-session", sourceLang, targetLang),
  startRecording: () => ipcRenderer.invoke("start-recording"),
  stopRecording: () => ipcRenderer.invoke("stop-recording"),
  toggleRecording: () => ipcRenderer.invoke("toggle-recording"),
  shutdownSession: () => ipcRenderer.invoke("shutdown-session"),

  onStateChange: createListener<UIState>("session:state-change"),
  onBlockAdded: createListener<TranscriptBlock>("session:block-added"),
  onBlockUpdated: createListener<TranscriptBlock>("session:block-updated"),
  onBlocksCleared: createListener<void>("session:blocks-cleared"),
  onSummaryUpdated: createListener<Summary | null>("session:summary-updated"),
  onCostUpdated: createListener<number>("session:cost-updated"),
  onStatus: createListener<string>("session:status"),
  onError: createListener<string>("session:error"),
};

contextBridge.exposeInMainWorld("electronAPI", api);
