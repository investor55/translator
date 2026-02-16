import type { Direction } from "./types";
import type { LanguageCode } from "./intro-screen";

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

export function buildAudioPromptForStructured(
  direction: Direction,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
  context: string[] = [],
  summaryPoints: string[] = []
): string {
  const summaryBlock = summaryPoints.length
    ? `Conversation summary so far:\n${summaryPoints.map((p) => `• ${p}`).join("\n")}\n\n`
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
      translateRule = `If ${sourceLangName}, translate to ${targetLangName}. If ${targetLangName}, translate to ${sourceLangName}.`;
    } else if (targetLang === "en") {
      translateRule = `If ${sourceLangName}, translate to ${targetLangName}. If ${targetLangName} (English), leave translation empty — no translation needed.`;
    } else {
      translateRule = `If ${sourceLangName}, translate to ${targetLangName}. If ${targetLangName}, translate to ${sourceLangName}. If English, leave translation empty — no translation needed.`;
    }

    return `${summaryBlock}${contextBlock}Listen to the audio clip. The speaker may be speaking ${langList}. The speaker may occasionally use English words or phrases even when primarily speaking another language.
1. Detect the spoken language (${codeList})
2. Transcribe the audio in its original language
3. ${translateRule}

If the audio is cut off mid-sentence, transcribe only what was actually spoken — do not add trailing punctuation or complete unfinished words/sentences. Set isPartial to true.

If there is no speech, silence, or unintelligible audio, return an empty transcript and empty translation.

Return sourceLanguage (${codeList}), transcript, isPartial, and translation.`;
  }

  const englishNote = sourceLang !== "en"
    ? ` The speaker may occasionally use English — if so, transcribe in English, set sourceLanguage to "en", and leave translation empty.`
    : "";

  return `${summaryBlock}${contextBlock}Listen to the audio clip spoken in ${sourceLangName}. Transcribe it in ${sourceLangName} and translate it into ${targetLangName}.${englishNote}

If the audio is cut off mid-sentence, transcribe only what was actually spoken — do not add trailing punctuation or complete unfinished words/sentences. Set isPartial to true.

If there is no speech, silence, or unintelligible audio, return an empty transcript and empty translation.`;
}

export function hasTranslatableContent(text: string): boolean {
  // Match any letter (including Unicode), number, or CJK characters
  return /[\p{L}\p{N}]/u.test(text);
}

// Character ranges for language detection
const LANG_CHAR_PATTERNS: Partial<Record<LanguageCode, RegExp>> = {
  ko: /[\uAC00-\uD7AF]/,  // Hangul
  ja: /[\u3040-\u309F\u30A0-\u30FF]/,  // Hiragana + Katakana
  zh: /[\u4E00-\u9FFF]/,  // CJK Unified Ideographs
  ar: /[\u0600-\u06FF]/,  // Arabic
  hi: /[\u0900-\u097F]/,  // Devanagari (Hindi)
  ru: /[\u0400-\u04FF]/,  // Cyrillic
};

export function detectSourceLanguage(
  text: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): LanguageCode {
  // Check if text matches source language pattern
  const sourcePattern = LANG_CHAR_PATTERNS[sourceLang];
  if (sourcePattern && sourcePattern.test(text)) {
    return sourceLang;
  }

  // Check if text matches target language pattern
  const targetPattern = LANG_CHAR_PATTERNS[targetLang];
  if (targetPattern && targetPattern.test(text)) {
    return targetLang;
  }

  // Default: assume source language for Latin-based scripts
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

    if (/[.!?。！？]/.test(ch)) {
      if (hasTranslatableContent(buffer)) {
        sentences.push(buffer.trim());
      }
      buffer = "";
    }
  }

  return { sentences, remainder: buffer };
}
