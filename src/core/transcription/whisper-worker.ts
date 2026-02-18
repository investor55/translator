/* eslint-disable no-console */

import { parentPort } from "node:worker_threads";

if (!parentPort) throw new Error("Must be run as a worker thread");

type Transcriber = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text?: string }>;
type IncomingMessage =
  | { id: number; type: "load"; modelId: string }
  | { id: number; type: "transcribe"; modelId: string; audio: ArrayBuffer; languageHints?: string[] };

let pipe: Transcriber | null = null;
let loadedModelId: string | null = null;

function normalizeLanguageHints(hints?: string[]): string[] {
  if (!hints?.length) return [];
  const cleaned = hints.map((h) => h.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(cleaned));
}

async function ensurePipeline(modelId: string): Promise<void> {
  if (pipe && loadedModelId === modelId) return;
  const transformers = await import("@huggingface/transformers");
  const pipelineFn = transformers.pipeline as unknown as (
    task: string,
    model: string,
    options: Record<string, unknown>
  ) => Promise<Transcriber>;
  console.log(`[whisper-worker] load:start model=${modelId}`);
  pipe = await pipelineFn("automatic-speech-recognition", modelId, {
    device: "cpu",
    dtype: "fp32",
  });
  loadedModelId = modelId;
  console.log(`[whisper-worker] load:done model=${modelId}`);
}

async function transcribeWithHints(audio: Float32Array, hints?: string[]): Promise<{ text?: string }> {
  const languageHints = normalizeLanguageHints(hints);
  const attempts: Array<string | null> = languageHints.length ? languageHints : [null];
  let lastError: Error | null = null;
  for (const lang of attempts) {
    const options: Record<string, unknown> = { task: "transcribe" };
    if (lang) options.language = lang;
    try {
      const startedAt = Date.now();
      console.log(
        `[whisper-worker] transcribe:attempt model=${loadedModelId ?? "-"} lang=${lang ?? "auto"} samples=${audio.length}`
      );
      const result = await pipe!(audio, options);
      console.log(
        `[whisper-worker] transcribe:done model=${loadedModelId ?? "-"} lang=${lang ?? "auto"} elapsed=${Date.now() - startedAt}ms textLen=${(result.text ?? "").trim().length}`
      );
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[whisper-worker] transcribe:error model=${loadedModelId ?? "-"} lang=${lang ?? "auto"} message=${lastError.message}`
      );
    }
  }
  throw (lastError ?? new Error("Unknown Whisper worker failure"));
}

parentPort.on("message", async (msg: IncomingMessage) => {
  const { id } = msg;
  const startedAt = Date.now();
  try {
    await ensurePipeline(msg.modelId);
    if (msg.type === "load") {
      parentPort!.postMessage({ id, type: "loaded" });
    } else if (msg.type === "transcribe") {
      const audio = new Float32Array(msg.audio);
      const result = await transcribeWithHints(audio, msg.languageHints);
      parentPort!.postMessage({ id, type: "result", text: result.text ?? "" });
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(
      `[whisper-worker] message:error id=${id} type=${msg.type} model=${msg.modelId} elapsed=${Date.now() - startedAt}ms message=${error.message}`
    );
    if (error.stack) console.error(`[whisper-worker] stack ${error.stack}`);
    parentPort!.postMessage({ id, type: "error", message: error.message });
  }
});

console.log("[whisper-worker] boot");
