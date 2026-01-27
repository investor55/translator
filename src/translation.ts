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

export function buildAudioPrompt(
  direction: Direction,
  context: string[] = []
): string {
  const contextBlock = context.length
    ? `Context (previous sentences, do not translate):\n${context.join("\n")}\n\n`
    : "";

  if (direction === "auto") {
    return `${contextBlock}You will receive an audio clip. Detect whether the language is Korean or English. Transcribe it in the original language and translate it into the other language. Return only valid JSON with keys "sourceLanguage" ("ko" or "en"), "transcript", and "translation". Do not add markdown or extra text.`;
  }

  const sourceLanguage = direction === "ko-en" ? "Korean" : "English";
  const targetLanguage = direction === "ko-en" ? "English" : "Korean";
  const sourceCode = direction === "ko-en" ? "ko" : "en";

  return `${contextBlock}You will receive an audio clip spoken in ${sourceLanguage}. Transcribe it in ${sourceLanguage} and translate it into ${targetLanguage}. Return only valid JSON with keys "sourceLanguage" ("${sourceCode}"), "transcript", and "translation". Do not add markdown or extra text.`;
}

export function buildAudioPromptForStructured(
  direction: Direction,
  context: string[] = []
): string {
  const contextBlock = context.length
    ? `Context (previous sentences for reference):\n${context.join("\n")}\n\n`
    : "";

  if (direction === "auto") {
    return `${contextBlock}Listen to the audio clip. Detect whether the language is Korean or English. Transcribe it in the original language and translate it into the other language.`;
  }

  const sourceLanguage = direction === "ko-en" ? "Korean" : "English";
  const targetLanguage = direction === "ko-en" ? "English" : "Korean";

  return `${contextBlock}Listen to the audio clip spoken in ${sourceLanguage}. Transcribe it in ${sourceLanguage} and translate it into ${targetLanguage}.`;
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
