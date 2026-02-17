import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { LanguageCode } from "./types";
import { isValidLangCode } from "./language";

type ElevenLabsSpeechToTextResponse = {
  text?: unknown;
  languageCode?: unknown;
  language_code?: unknown;
  languageProbability?: unknown;
  language_probability?: unknown;
};

const ELEVENLABS_LANGUAGE_MAP: Record<string, LanguageCode> = {
  eng: "en",
  spa: "es",
  fra: "fr",
  deu: "de",
  ita: "it",
  por: "pt",
  zho: "zh",
  jpn: "ja",
  kor: "ko",
  ara: "ar",
  hin: "hi",
  rus: "ru",
  fil: "tl",
  tgl: "tl",
};

function normalizeLanguageCode(code?: string): LanguageCode | undefined {
  if (!code) return undefined;
  const normalized = code.trim().toLowerCase();
  if (isValidLangCode(normalized)) return normalized;
  return ELEVENLABS_LANGUAGE_MAP[normalized];
}

export type ElevenLabsTranscription = {
  transcript: string;
  sourceLanguage?: LanguageCode;
  languageProbability?: number;
};

let cachedClient: ElevenLabsClient | null = null;
let cachedApiKey: string | null = null;

function getElevenLabsClient(apiKey: string): ElevenLabsClient {
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new ElevenLabsClient({ apiKey });
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`ElevenLabs STT request timed out (${timeoutMs}ms)`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export async function transcribeWithElevenLabs(
  wavBuffer: Buffer,
  modelId: string
): Promise<ElevenLabsTranscription> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }

  const bytes = Uint8Array.from(wavBuffer);
  const file = new File([bytes], "chunk.wav", { type: "audio/wav" });
  const payload = await withTimeout(
    getElevenLabsClient(apiKey).speechToText.convert({
      file,
      modelId,
    }),
    30000
  ) as ElevenLabsSpeechToTextResponse;
  const languageCodeRaw =
    typeof payload.languageCode === "string"
      ? payload.languageCode
      : typeof payload.language_code === "string"
        ? payload.language_code
        : undefined;
  const languageProbabilityRaw =
    typeof payload.languageProbability === "number"
      ? payload.languageProbability
      : typeof payload.language_probability === "number"
        ? payload.language_probability
        : undefined;

  return {
    transcript: typeof payload.text === "string" ? payload.text.trim() : "",
    sourceLanguage: normalizeLanguageCode(languageCodeRaw),
    languageProbability: languageProbabilityRaw,
  };
}
