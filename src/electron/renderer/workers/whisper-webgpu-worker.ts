/// <reference lib="webworker" />

import { pipeline } from "@huggingface/transformers";
import type { WhisperGpuRequest, WhisperGpuResponse } from "../../ipc/whisper-gpu-types";

type DataType = "fp32" | "fp16";

type Transcriber = ((
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text?: string }>) & {
  dispose?: () => Promise<void> | void;
};

let transcriber: Transcriber | null = null;
let loadedModelId: string | null = null;
let loadedDtype: DataType | null = null;

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
    // Typical case when structured-cloned payload arrives as byte-oriented view.
    if (bytes.byteLength % 4 === 0) {
      return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    if (bytes.byteLength % 2 === 0) {
      const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      return int16ToFloat32(pcm);
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

function normalizeLanguageHints(hints?: string[]): string[] {
  if (!hints?.length) return [];
  const cleaned = hints.map((hint) => hint.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(cleaned));
}

async function disposePipeline(): Promise<void> {
  if (transcriber?.dispose) {
    await transcriber.dispose();
  }
  transcriber = null;
  loadedModelId = null;
  loadedDtype = null;
}

async function loadPipeline(modelId: string): Promise<void> {
  await disposePipeline();
  let lastError: Error | null = null;
  // Prefer fp32 first for stability/quality on current WebGPU stacks.
  const dtypes: DataType[] = ["fp32", "fp16"];

  for (const dtype of dtypes) {
    try {
      transcriber = await pipeline("automatic-speech-recognition", modelId, {
        device: "webgpu",
        dtype,
      }) as unknown as Transcriber;
      loadedModelId = modelId;
      loadedDtype = dtype;
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw (lastError ?? new Error("Unknown Whisper WebGPU load failure"));
}

async function ensurePipeline(modelId: string): Promise<void> {
  if (transcriber && loadedModelId === modelId) return;
  await loadPipeline(modelId);
}

async function transcribeWithHints(audio: Float32Array, languageHints?: string[]): Promise<string> {
  const hints = normalizeLanguageHints(languageHints);
  const attempts: Array<string | null> = hints.length > 0 ? hints : [null];
  let lastError: Error | null = null;

  for (const hint of attempts) {
    const options: Record<string, unknown> = { task: "transcribe" };
    if (hint) options.language = hint;
    try {
      const result = await transcriber!(audio, options);
      return (result.text ?? "").trim();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw (lastError ?? new Error("Unknown Whisper WebGPU transcription failure"));
}

function postMessageSafe(message: WhisperGpuResponse): void {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<WhisperGpuRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object" || typeof msg.id !== "number") return;

  try {
    if (msg.type === "dispose") {
      await disposePipeline();
      postMessageSafe({ id: msg.id, type: "disposed" });
      return;
    }

    await ensurePipeline(msg.modelId);

    if (msg.type === "load") {
      postMessageSafe({ id: msg.id, type: "loaded" });
      return;
    }

    const transcript = await transcribeWithHints(toFloat32Audio(msg.audio), msg.languageHints);
    postMessageSafe({ id: msg.id, type: "result", text: transcript });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessageSafe({ id: msg.id, type: "error", message });
  }
};
