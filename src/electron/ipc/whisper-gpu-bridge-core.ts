import { log } from "../../core/logger";
import type { WhisperRemoteRuntime } from "../../core/transcription/whisper-local";
import type {
  WhisperGpuReadyPayload,
  WhisperGpuRequest,
  WhisperGpuResponse,
} from "./whisper-gpu-types";

type PendingRequest = {
  resolve: (response: WhisperGpuResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type WhisperGpuBridgeTransport = {
  sendRequest: (request: WhisperGpuRequest) => boolean;
  onResponse: (callback: (response: WhisperGpuResponse) => void) => () => void;
  onReady: (callback: (payload: WhisperGpuReadyPayload) => void) => () => void;
};

type WhisperGpuRequestPayload =
  | { type: "load"; modelId: string }
  | {
      type: "transcribe";
      modelId: string;
      audio: Float32Array;
      languageHints?: string[];
    }
  | { type: "dispose" };

type WhisperGpuBridgeOptions = {
  requestTimeoutMs?: number;
  logger?: (level: "INFO" | "WARN" | "ERROR", message: string) => void;
};

export type WhisperGpuBridge = {
  runtime: WhisperRemoteRuntime;
  dispose: () => void;
};

export function createWhisperGpuBridgeManager(
  transport: WhisperGpuBridgeTransport,
  options: WhisperGpuBridgeOptions = {},
): WhisperGpuBridge {
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const writeLog = options.logger ?? log;
  const pending = new Map<number, PendingRequest>();
  let nextId = 0;
  let readySeen = false;
  let supported = false;

  const rejectPendingRequest = (id: number, error: Error) => {
    const current = pending.get(id);
    if (!current) return;
    pending.delete(id);
    clearTimeout(current.timeout);
    current.reject(error);
  };

  const resolvePendingRequest = (id: number, response: WhisperGpuResponse) => {
    const current = pending.get(id);
    if (!current) return;
    pending.delete(id);
    clearTimeout(current.timeout);
    current.resolve(response);
  };

  const rejectAllPending = (message: string) => {
    for (const [id] of pending) {
      rejectPendingRequest(id, new Error(message));
    }
  };

  const callRenderer = (
    request: WhisperGpuRequestPayload,
    timeoutMs = requestTimeoutMs,
  ): Promise<WhisperGpuResponse> => {
    if (!(readySeen && supported)) {
      return Promise.reject(new Error("Whisper GPU renderer is unavailable"));
    }

    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const payload = { ...request, id } as WhisperGpuRequest;
      const timeout = setTimeout(() => {
        rejectPendingRequest(
          id,
          new Error(`Whisper GPU request timed out: op=${request.type} timeoutMs=${timeoutMs}`),
        );
      }, timeoutMs);

      pending.set(id, { resolve, reject, timeout });
      const sent = transport.sendRequest(payload);
      if (!sent) {
        rejectPendingRequest(id, new Error("Whisper GPU renderer window unavailable"));
      }
    });
  };

  const offResponse = transport.onResponse((response) => {
    if (!response || typeof response !== "object" || typeof response.id !== "number") return;
    if (response.type === "error") {
      rejectPendingRequest(
        response.id,
        new Error(response.message || "Unknown renderer Whisper GPU error"),
      );
      return;
    }
    resolvePendingRequest(response.id, response);
  });

  const offReady = transport.onReady((payload) => {
    readySeen = true;
    supported = !!payload?.supported;
    writeLog(
      "INFO",
      `Whisper GPU renderer ready signal received: supported=${supported}`,
    );
    if (!supported) {
      rejectAllPending("Whisper GPU unsupported in renderer");
    }
  });

  const runtime: WhisperRemoteRuntime = {
    isReady: () => readySeen && supported,
    async preload(modelId: string): Promise<void> {
      const response = await callRenderer({ type: "load", modelId });
      if (response.type !== "loaded") {
        throw new Error(`Unexpected Whisper GPU preload response: ${response.type}`);
      }
    },
    async transcribe(
      audio: Float32Array,
      modelId: string,
      languageHints: string[],
    ): Promise<string> {
      const response = await callRenderer({ type: "transcribe", modelId, audio, languageHints });
      if (response.type !== "result") {
        throw new Error(`Unexpected Whisper GPU transcribe response: ${response.type}`);
      }
      return response.text;
    },
    async dispose(): Promise<void> {
      if (!(readySeen && supported)) return;
      try {
        await callRenderer({ type: "dispose" });
      } catch (error) {
        writeLog(
          "WARN",
          `Whisper GPU dispose request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };

  const dispose = () => {
    offResponse();
    offReady();
    rejectAllPending("Whisper GPU bridge disposed");
    readySeen = false;
    supported = false;
  };

  return { runtime, dispose };
}
