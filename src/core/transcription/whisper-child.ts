/* eslint-disable no-console */

type DataType = "auto" | "fp32" | "fp16" | "q8" | "int8" | "uint8" | "q4" | "bnb4" | "q4f16";

type Transcriber = ((
  audio: Float32Array,
  opts: Record<string, unknown>
) => Promise<{ text?: string }>) & {
  dispose?: () => Promise<void> | void;
};

type IncomingMessage =
  | { id: number; type: "load"; modelId: string }
  | { id: number; type: "transcribe"; modelId: string; audio: Float32Array | ArrayBuffer; languageHints?: string[] }
  | { id: number; type: "dispose" };

if (!process.send) {
  throw new Error("Whisper child must be started with an IPC channel");
}

let pipe: Transcriber | null = null;
let loadedModelId: string | null = null;
let loadedDtype: DataType | Record<string, DataType> | null = null;

function memSnapshot(): string {
  const mem = process.memoryUsage();
  const toMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  return `rss=${toMb(mem.rss)}MB heap=${toMb(mem.heapUsed)}/${toMb(mem.heapTotal)}MB ext=${toMb(mem.external)}MB`;
}

function normalizeLanguageHints(hints?: string[]): string[] {
  if (!hints?.length) return [];
  const cleaned = hints
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

function pickDtype(): DataType | Record<string, DataType> {
  const requested = process.env.WHISPER_DTYPE?.trim() as DataType | undefined;
  if (requested && ["auto", "fp32", "fp16", "q8", "int8", "uint8", "q4", "bnb4", "q4f16"].includes(requested)) {
    return requested;
  }
  // Stability-first default. q8 was crashing with SIGTRAP in native inference.
  return "fp32";
}

async function disposePipeline(): Promise<void> {
  if (pipe?.dispose) {
    await pipe.dispose();
  }
  pipe = null;
  loadedModelId = null;
  loadedDtype = null;
}

async function ensurePipeline(modelId: string): Promise<void> {
  if (pipe && loadedModelId === modelId) return;
  await disposePipeline();

  const dtype = pickDtype();
  const transformers = await import("@huggingface/transformers");
  const pipelineFn = transformers.pipeline as unknown as (
    task: string,
    model: string,
    options: Record<string, unknown>
  ) => Promise<Transcriber>;

  const startedAt = Date.now();
  console.log(`[whisper-child] load:start model=${modelId} dtype=${JSON.stringify(dtype)} ${memSnapshot()}`);
  pipe = await pipelineFn("automatic-speech-recognition", modelId, {
    device: "cpu",
    dtype,
  });
  loadedModelId = modelId;
  loadedDtype = dtype;
  console.log(`[whisper-child] load:done model=${modelId} elapsed=${Date.now() - startedAt}ms ${memSnapshot()}`);
}

function sendMessage(message: unknown): void {
  if (process.send) process.send(message);
}

function toFloat32Array(audio: Float32Array | ArrayBuffer): Float32Array {
  return audio instanceof Float32Array ? audio : new Float32Array(audio);
}

async function transcribeWithHints(
  audio: Float32Array,
  languageHints: string[] | undefined,
): Promise<{ text?: string }> {
  const hints = normalizeLanguageHints(languageHints);
  const attempts: Array<string | null> = hints.length ? hints : [null];
  let lastError: Error | null = null;

  for (const hint of attempts) {
    const startedAt = Date.now();
    const options: Record<string, unknown> = { task: "transcribe" };
    if (hint) options.language = hint;

    try {
      console.log(
        `[whisper-child] transcribe:attempt model=${loadedModelId ?? "-"} lang=${hint ?? "auto"} samples=${audio.length} durationMs=${((audio.length / 16000) * 1000).toFixed(0)}`
      );
      const result = await pipe!(audio, options);
      const text = result.text ?? "";
      console.log(
        `[whisper-child] transcribe:done model=${loadedModelId ?? "-"} lang=${hint ?? "auto"} textLen=${text.trim().length} elapsed=${Date.now() - startedAt}ms ${memSnapshot()}`
      );
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[whisper-child] transcribe:error model=${loadedModelId ?? "-"} lang=${hint ?? "auto"} elapsed=${Date.now() - startedAt}ms message=${lastError.message}`
      );
    }
  }

  throw (lastError ?? new Error("Unknown Whisper transcription failure"));
}

async function handleMessage(msg: IncomingMessage): Promise<void> {
  const { id } = msg;
  const startedAt = Date.now();

  try {
    if (msg.type === "dispose") {
      await disposePipeline();
      sendMessage({ id, type: "disposed" });
      console.log(`[whisper-child] dispose:done elapsed=${Date.now() - startedAt}ms ${memSnapshot()}`);
      return;
    }

    await ensurePipeline(msg.modelId);
    if (msg.type === "load") {
      sendMessage({ id, type: "loaded" });
      return;
    }

    const audio = toFloat32Array(msg.audio);
    const result = await transcribeWithHints(audio, msg.languageHints);
    sendMessage({ id, type: "result", text: result.text ?? "" });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(
      `[whisper-child] message:error id=${id} type=${msg.type} model=${"modelId" in msg ? msg.modelId : "-"} elapsed=${Date.now() - startedAt}ms message=${error.message}`
    );
    if (error.stack) {
      console.error(`[whisper-child] stack ${error.stack}`);
    }
    sendMessage({ id, type: "error", message: error.message });
  }
}

process.on("message", (raw) => {
  if (!raw || typeof raw !== "object" || !("type" in raw) || !("id" in raw)) return;
  void handleMessage(raw as IncomingMessage);
});

process.on("uncaughtException", (error) => {
  console.error(`[whisper-child] uncaughtException ${error.message}`);
  if (error.stack) console.error(`[whisper-child] stack ${error.stack}`);
  console.error(`[whisper-child] ${memSnapshot()}`);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`[whisper-child] unhandledRejection ${message}`);
  console.error(`[whisper-child] ${memSnapshot()}`);
});

process.on("disconnect", () => {
  console.log("[whisper-child] disconnect received");
  void disposePipeline().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  console.log("[whisper-child] SIGTERM received");
  void disposePipeline().finally(() => process.exit(0));
});

console.log(
  `[whisper-child] boot pid=${process.pid} node=${process.version} platform=${process.platform} arch=${process.arch}`
);
