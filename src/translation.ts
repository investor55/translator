import type { Direction, FixedDirection } from "./types";

export function buildPrompt(text: string, direction: FixedDirection): string {
  const target = direction === "ko-en" ? "English" : "Korean";
  return `Translate to ${target}:\n${text}`;
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
