import type { WhisperGpuRequest, WhisperGpuResponse } from "../../ipc/whisper-gpu-types";

let started = false;
let worker: Worker | null = null;
const pendingRequestIds = new Set<number>();

function int16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    output[i] = input[i] / 32768;
  }
  return output;
}

function toFloat32Audio(raw: unknown): Float32Array {
  if (raw instanceof Float32Array) return raw;
  if (raw instanceof ArrayBuffer) return new Float32Array(raw);
  if (ArrayBuffer.isView(raw)) {
    if (raw instanceof Float32Array) return raw;
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (bytes.byteLength % 4 === 0) {
      return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    if (bytes.byteLength % 2 === 0) {
      return int16ToFloat32(
        new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      );
    }
  }
  if (Array.isArray(raw)) {
    return Float32Array.from(raw);
  }
  if (
    raw &&
    typeof raw === "object" &&
    "type" in raw &&
    (raw as { type?: string }).type === "Buffer" &&
    "data" in raw &&
    Array.isArray((raw as { data?: unknown[] }).data)
  ) {
    const bytes = Uint8Array.from((raw as { data: number[] }).data);
    if (bytes.byteLength % 4 === 0) {
      return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    if (bytes.byteLength % 2 === 0) {
      return int16ToFloat32(new Int16Array(bytes.buffer));
    }
  }
  throw new Error("Unsupported Whisper GPU audio payload shape");
}

function postResponse(response: WhisperGpuResponse): void {
  window.electronAPI.sendWhisperGpuResponse(response);
}

function disposeWorker(): void {
  worker?.terminate();
  worker = null;
}

function failPendingRequests(message: string): void {
  for (const id of pendingRequestIds) {
    postResponse({ id, type: "error", message });
  }
  pendingRequestIds.clear();
}

function attachWorkerEventHandlers(nextWorker: Worker): void {
  nextWorker.onmessage = (event: MessageEvent<WhisperGpuResponse>) => {
    const response = event.data;
    if (!response || typeof response !== "object" || typeof response.id !== "number") return;
    pendingRequestIds.delete(response.id);
    postResponse(response);
  };

  nextWorker.onerror = (event) => {
    const message = event.message || "Whisper WebGPU worker crashed";
    failPendingRequests(message);
    disposeWorker();
  };
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const nextWorker = new Worker(
    new URL("../workers/whisper-webgpu-worker.ts", import.meta.url),
    { type: "module" },
  );
  attachWorkerEventHandlers(nextWorker);
  worker = nextWorker;
  return nextWorker;
}

function forwardRequestToWorker(request: WhisperGpuRequest): void {
  try {
    const target = ensureWorker();
    pendingRequestIds.add(request.id);

    if (request.type === "transcribe") {
      const normalizedAudio = toFloat32Audio((request as { audio: unknown }).audio);
      target.postMessage({
        ...request,
        audio: normalizedAudio,
      });
      return;
    }

    target.postMessage(request);
  } catch (error) {
    pendingRequestIds.delete(request.id);
    postResponse({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function initializeWhisperGpuClient(): void {
  if (started) return;
  started = true;

  const supported = typeof navigator !== "undefined" && "gpu" in navigator;
  window.electronAPI.notifyWhisperGpuReady({ supported });

  window.electronAPI.onWhisperGpuRequest((request) => {
    if (!supported) {
      postResponse({
        id: request.id,
        type: "error",
        message: "WebGPU is unavailable in this renderer context",
      });
      return;
    }
    forwardRequestToWorker(request);
  });
}
