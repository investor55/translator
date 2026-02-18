export const WHISPER_GPU_REQUEST_CHANNEL = "whisper-gpu:request";
export const WHISPER_GPU_RESPONSE_CHANNEL = "whisper-gpu:response";
export const WHISPER_GPU_READY_CHANNEL = "whisper-gpu:ready";

export type WhisperGpuRequest =
  | { id: number; type: "load"; modelId: string }
  | {
      id: number;
      type: "transcribe";
      modelId: string;
      audio: Float32Array;
      languageHints?: string[];
    }
  | { id: number; type: "dispose" };

export type WhisperGpuResponse =
  | { id: number; type: "loaded" }
  | { id: number; type: "result"; text: string }
  | { id: number; type: "disposed" }
  | { id: number; type: "error"; message: string };

export type WhisperGpuReadyPayload = {
  supported: boolean;
};
