import type { LanguageCode } from "./types";
import { detectSourceLanguage } from "./language";
import { log } from "./logger";

export function pcmToFloat32(pcmBuffer: Buffer): Float32Array {
  const samples = pcmBuffer.length / 2;
  const float32 = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    float32[i] = pcmBuffer.readInt16LE(i * 2) / 32768.0;
  }
  return float32;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WhisperPipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<any>;

type SingletonState =
  | { kind: "idle" }
  | { kind: "loading"; promise: Promise<WhisperPipeline> }
  | { kind: "ready"; pipe: WhisperPipeline }
  | { kind: "failed"; error: Error };

let state: SingletonState = { kind: "idle" };

export function preloadWhisperPipeline(modelId: string): Promise<WhisperPipeline> {
  if (state.kind === "ready") return Promise.resolve(state.pipe);
  if (state.kind === "loading") return state.promise;

  const promise = (async (): Promise<WhisperPipeline> => {
    try {
      log("INFO", `Loading Whisper model: ${modelId}`);
      const { pipeline } = await import("@huggingface/transformers");
      const pipe = await pipeline("automatic-speech-recognition", modelId, {
        dtype: "fp32",  // q8 degrades Korean accuracy
        device: "auto", // uses CoreML on Apple Silicon via onnxruntime-node
      });
      state = { kind: "ready", pipe: pipe as WhisperPipeline };
      log("INFO", `Whisper model ready: ${modelId}`);
      return pipe as WhisperPipeline;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      state = { kind: "failed", error };
      throw error;
    }
  })();

  state = { kind: "loading", promise };
  return promise;
}

export function disposeWhisperPipeline(): void {
  state = { kind: "idle" };
}

export type WhisperResult = { transcript: string; detectedLang: LanguageCode };

export async function transcribeWithWhisper(
  pcmBuffer: Buffer,
  modelId: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
): Promise<WhisperResult> {
  const pipe = await preloadWhisperPipeline(modelId);
  const audio = pcmToFloat32(pcmBuffer);

  // No chunk_length_s / stride_length_s — those are for multi-minute files.
  // Our VAD clips are 500–4000ms; passing a stride longer than the clip itself
  // causes an out-of-bounds crash inside the pipeline.
  // task:"transcribe" prevents Whisper from translating internally.
  const result = await pipe(audio, { task: "transcribe" }) as { text?: string };

  const transcript = (result.text ?? "").trim();
  // Character-pattern detection (Hangul, CJK, Arabic, etc.) is accurate for
  // the languages this app targets and avoids relying on the model's language
  // token which isn't reliably surfaced through the JS pipeline.
  const detectedLang = detectSourceLanguage(transcript, sourceLang, targetLang);

  return { transcript, detectedLang };
}
