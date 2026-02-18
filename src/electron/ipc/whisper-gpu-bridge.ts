import { type BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { log } from "../../core/logger";
import {
  createWhisperGpuBridgeManager,
  type WhisperGpuBridge,
  type WhisperGpuBridgeTransport,
} from "./whisper-gpu-bridge-core";
import {
  WHISPER_GPU_READY_CHANNEL,
  WHISPER_GPU_REQUEST_CHANNEL,
  WHISPER_GPU_RESPONSE_CHANNEL,
  type WhisperGpuReadyPayload,
  type WhisperGpuResponse,
} from "./whisper-gpu-types";

export { createWhisperGpuBridgeManager } from "./whisper-gpu-bridge-core";

export function registerElectronWhisperGpuBridge(
  getWindow: () => BrowserWindow | null,
): WhisperGpuBridge {
  const responseListeners = new Set<(response: WhisperGpuResponse) => void>();
  const readyListeners = new Set<(payload: WhisperGpuReadyPayload) => void>();

  const handleResponse = (_event: IpcMainEvent, response: WhisperGpuResponse) => {
    for (const listener of responseListeners) {
      listener(response);
    }
  };

  const handleReady = (_event: IpcMainEvent, payload: WhisperGpuReadyPayload) => {
    for (const listener of readyListeners) {
      listener(payload);
    }
  };

  ipcMain.on(WHISPER_GPU_RESPONSE_CHANNEL, handleResponse);
  ipcMain.on(WHISPER_GPU_READY_CHANNEL, handleReady);

  const transport: WhisperGpuBridgeTransport = {
    sendRequest(request) {
      const win = getWindow();
      if (!win || win.isDestroyed()) return false;
      win.webContents.send(WHISPER_GPU_REQUEST_CHANNEL, request);
      return true;
    },
    onResponse(callback) {
      responseListeners.add(callback);
      return () => responseListeners.delete(callback);
    },
    onReady(callback) {
      readyListeners.add(callback);
      return () => readyListeners.delete(callback);
    },
  };

  const bridge = createWhisperGpuBridgeManager(transport, {
    logger: (level, message) => log(level, message),
  });

  return {
    runtime: bridge.runtime,
    dispose: () => {
      bridge.dispose();
      ipcMain.removeListener(WHISPER_GPU_RESPONSE_CHANNEL, handleResponse);
      ipcMain.removeListener(WHISPER_GPU_READY_CHANNEL, handleReady);
      responseListeners.clear();
      readyListeners.clear();
    },
  };
}
