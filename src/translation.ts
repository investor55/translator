import type { Direction, FixedDirection } from "./types";

export function buildPrompt(
  text: string,
  direction: FixedDirection,
  context: string[] = []
): string {
  const target = direction === "ko-en" ? "English" : "Korean";
  const contextBlock = context.length
    ? `Context (previous sentences, do not translate):\n${context.join("\n")}\n\n`
    : "";
  return `${contextBlock}Current sentence to translate into ${target}. Output only the translated text, no explanations or markdown.\n${text}`;
}

const LANG_NAMES: Record<string, string> = {
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese",
  es: "Spanish",
  fr: "French",
  de: "German",
  en: "English",
};

export function buildAudioPromptForStructured(
  direction: Direction,
  context: string[] = [],
  sourceLang = "ko"
): string {
  const contextBlock = context.length
    ? `Context (previous sentences for reference):\n${context.join("\n")}\n\n`
    : "";

  const sourceLangName = LANG_NAMES[sourceLang] || sourceLang.toUpperCase();

  if (direction === "auto") {
    return `${contextBlock}Listen to the audio clip. The audio is either ${sourceLangName} or English.
1. Detect whether the language is ${sourceLangName} ("${sourceLang}") or English ("en")
2. Transcribe the audio in its original language
3. If ${sourceLangName}, translate to English. If English, leave translation empty.

If there is no speech, silence, or unintelligible audio, return an empty transcript and empty translation.

Return sourceLanguage ("${sourceLang}" or "en"), transcript, and translation (empty string if English).`;
  }

  const sourceLanguage = direction === "ko-en" ? sourceLangName : "English";
  const targetLanguage = direction === "ko-en" ? "English" : sourceLangName;

  return `${contextBlock}Listen to the audio clip spoken in ${sourceLanguage}. Transcribe it in ${sourceLanguage} and translate it into ${targetLanguage}.

If there is no speech, silence, or unintelligible audio, return an empty transcript and empty translation.`;
}

export function hasTranslatableContent(text: string): boolean {
  return /[A-Za-z0-9가-힣]/.test(text);
}

export function resolveDirection(
  text: string,
  direction: Direction
): FixedDirection {
  if (direction !== "auto") {
    return direction;
  }
  return /[가-힣]/.test(text) ? "ko-en" : "en-ko";
}

export function extractSentences(text: string): {
  sentences: string[];
  remainder: string;
} {
  const sentences: string[] = [];
  let buffer = "";

  for (const ch of text) {
    if (ch === "\n") {
      if (hasTranslatableContent(buffer)) {
        sentences.push(buffer.trim());
      }
      buffer = "";
      continue;
    }

    buffer += ch;

    if (/[.!?。！？]/.test(ch)) {
      if (hasTranslatableContent(buffer)) {
        sentences.push(buffer.trim());
      }
      buffer = "";
    }
  }

  return { sentences, remainder: buffer };
}
