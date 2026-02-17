import type { LanguageCode } from "./types";
import { isValidLangCode } from "./language";

type ElevenLabsSpeechToTextResponse = {
  text?: string;
  language_code?: string;
  language_probability?: number;
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

export async function transcribeWithElevenLabs(
  wavBuffer: Buffer,
  modelId: string
): Promise<ElevenLabsTranscription> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }

  const formData = new FormData();
  const bytes = Uint8Array.from(wavBuffer);
  formData.append("model_id", modelId);
  formData.append("file", new Blob([bytes], { type: "audio/wav" }), "chunk.wav");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`ElevenLabs STT request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as ElevenLabsSpeechToTextResponse;
  return {
    transcript: typeof payload.text === "string" ? payload.text.trim() : "",
    sourceLanguage: normalizeLanguageCode(payload.language_code),
    languageProbability:
      typeof payload.language_probability === "number"
        ? payload.language_probability
        : undefined,
  };
}
