import type { Direction, LanguageCode } from "./types";
import { SUPPORTED_LANGUAGES } from "./types";

export const LANG_NAMES: Record<LanguageCode, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  ru: "Russian",
  tl: "Tagalog",
};

const LANG_CHAR_PATTERNS: Partial<Record<LanguageCode, RegExp>> = {
  ko: /[\uAC00-\uD7AF]/,
  ja: /[\u3040-\u309F\u30A0-\u30FF]/,
  zh: /[\u4E00-\u9FFF]/,
  ar: /[\u0600-\u06FF]/,
  hi: /[\u0900-\u097F]/,
  ru: /[\u0400-\u04FF]/,
};

export function getLanguageLabel(code: LanguageCode): string {
  return code.toUpperCase();
}

export function getLanguageName(code: LanguageCode): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

export function isValidLangCode(code: string): code is LanguageCode {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

export function hasTranslatableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export function detectSourceLanguage(
  text: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): LanguageCode {
  const sourcePattern = LANG_CHAR_PATTERNS[sourceLang];
  if (sourcePattern && sourcePattern.test(text)) {
    return sourceLang;
  }

  const targetPattern = LANG_CHAR_PATTERNS[targetLang];
  if (targetPattern && targetPattern.test(text)) {
    return targetLang;
  }

  return sourceLang;
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

    if (/[.!?\u3002\uFF01\uFF1F]/.test(ch)) {
      if (hasTranslatableContent(buffer)) {
        sentences.push(buffer.trim());
      }
      buffer = "";
    }
  }

  return { sentences, remainder: buffer };
}

export function buildAudioPromptForStructured(
  direction: Direction,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  context: string[] = [],
  summaryPoints: string[] = []
): string {
  const summaryBlock = summaryPoints.length
    ? `Conversation summary so far:\n${summaryPoints.map((p) => `\u2022 ${p}`).join("\n")}\n\n`
    : "";
  const contextBlock = context.length
    ? `Context (previous sentences for reference):\n${context.join("\n")}\n\n`
    : "";

  const sourceLangName = LANG_NAMES[sourceLang];
  const targetLangName = LANG_NAMES[targetLang];

  const englishIsConfigured = sourceLang === "en" || targetLang === "en";
  const langList = englishIsConfigured
    ? `${sourceLangName} or ${targetLangName}`
    : `${sourceLangName}, ${targetLangName}, or English`;
  const codeList = englishIsConfigured
    ? `"${sourceLang}" or "${targetLang}"`
    : `"${sourceLang}", "${targetLang}", or "en"`;

  if (direction === "auto") {
    let translateRule: string;
    if (sourceLang === "en") {
      translateRule = `If the speech is ${sourceLangName}, translate to ${targetLangName}. If the speech is ${targetLangName}, translate to ${sourceLangName}. The translation MUST always be in a different language than the transcript.`;
    } else if (targetLang === "en") {
      translateRule = `If the speech is ${sourceLangName}, the translation MUST be in ${targetLangName} (English). If the speech is already ${targetLangName} (English), leave translation empty. The translation must NEVER be in the same language as the transcript.`;
    } else {
      translateRule = `If the speech is ${sourceLangName}, the translation MUST be in ${targetLangName}. If the speech is ${targetLangName}, the translation MUST be in ${sourceLangName}. If English, leave translation empty. The translation must NEVER be in the same language as the transcript.`;
    }

    return `${summaryBlock}${contextBlock}Listen to the audio clip. The speaker may be speaking ${langList}. The speaker may occasionally use English words or phrases even when primarily speaking another language \u2014 treat code-switching as part of the primary language, not as a language change.
1. Detect the primary spoken language (${codeList})
2. Transcribe the audio in its original language
3. ${translateRule}

IMPORTANT: The transcript field must be in the detected source language. The translation field must ALWAYS be in a DIFFERENT language than the transcript. If you hear ${sourceLangName}, the translation must be ${targetLangName}, not ${sourceLangName}.

You are a strict transcriber. Output ONLY the exact words spoken \u2014 never add, infer, or complete words or sentences beyond what is audible.

If the audio is cut off mid-sentence, transcribe only what was actually spoken. Set isPartial to true.

If there is no speech, silence, or unintelligible audio, return an empty transcript and empty translation.

Return sourceLanguage (${codeList}), transcript, isPartial, and translation.`;
  }

  const englishNote = sourceLang !== "en"
    ? ` The speaker may occasionally use English words/phrases \u2014 treat this as code-switching within ${sourceLangName}, not a language change.`
    : "";

  return `${summaryBlock}${contextBlock}Listen to the audio clip spoken in ${sourceLangName}. Transcribe it in ${sourceLangName} and translate it into ${targetLangName}.${englishNote}

IMPORTANT: The translation MUST be in ${targetLangName}. Never return a translation in the same language as the transcript.

You are a strict transcriber. Output ONLY the exact words spoken \u2014 never add, infer, or complete words or sentences beyond what is audible.

If the audio is cut off mid-sentence, transcribe only what was actually spoken. Set isPartial to true.

If there is no speech, silence, or unintelligible audio, return an empty transcript and empty translation.`;
}
