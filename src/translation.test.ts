import { describe, it, expect } from "vitest";
import {
  buildPrompt,
  buildAudioPrompt,
  buildAudioPromptForStructured,
  hasTranslatableContent,
  resolveDirection,
  extractSentences,
} from "./translation";

describe("buildPrompt", () => {
  it("builds ko-en prompt without context", () => {
    const result = buildPrompt("안녕하세요", "ko-en", []);
    expect(result).toContain("English");
    expect(result).toContain("안녕하세요");
    expect(result).not.toContain("Context");
  });

  it("builds en-ko prompt without context", () => {
    const result = buildPrompt("Hello", "en-ko", []);
    expect(result).toContain("Korean");
    expect(result).toContain("Hello");
  });

  it("includes context when provided", () => {
    const context = ["Previous sentence one.", "Previous sentence two."];
    const result = buildPrompt("Current text", "ko-en", context);
    expect(result).toContain("Context");
    expect(result).toContain("Previous sentence one.");
    expect(result).toContain("Previous sentence two.");
  });
});

describe("buildAudioPrompt", () => {
  it("builds auto-detect prompt", () => {
    const result = buildAudioPrompt("auto", []);
    expect(result).toContain("Detect");
    expect(result).toContain("Korean or English");
    expect(result).toContain("JSON");
  });

  it("builds ko-en fixed direction prompt", () => {
    const result = buildAudioPrompt("ko-en", []);
    expect(result).toContain("Korean");
    expect(result).toContain("English");
    expect(result).toContain('"ko"');
  });

  it("builds en-ko fixed direction prompt", () => {
    const result = buildAudioPrompt("en-ko", []);
    expect(result).toContain("English");
    expect(result).toContain("Korean");
    expect(result).toContain('"en"');
  });

  it("includes context when provided", () => {
    const context = ["Previous sentence."];
    const result = buildAudioPrompt("auto", context);
    expect(result).toContain("Context");
    expect(result).toContain("Previous sentence.");
  });
});

describe("buildAudioPromptForStructured", () => {
  it("builds auto-detect prompt for structured output", () => {
    const result = buildAudioPromptForStructured("auto", []);
    expect(result).toContain("Detect");
    expect(result).toContain("Korean or English");
    expect(result).not.toContain("JSON");
  });

  it("builds ko-en prompt for structured output", () => {
    const result = buildAudioPromptForStructured("ko-en", []);
    expect(result).toContain("Korean");
    expect(result).toContain("English");
  });

  it("builds en-ko prompt for structured output", () => {
    const result = buildAudioPromptForStructured("en-ko", []);
    expect(result).toContain("English");
    expect(result).toContain("Korean");
  });

  it("includes context when provided", () => {
    const context = ["Context sentence."];
    const result = buildAudioPromptForStructured("auto", context);
    expect(result).toContain("Context");
    expect(result).toContain("Context sentence.");
  });
});

describe("hasTranslatableContent", () => {
  it("returns true for Korean text", () => {
    expect(hasTranslatableContent("안녕하세요")).toBe(true);
  });

  it("returns true for English text", () => {
    expect(hasTranslatableContent("Hello world")).toBe(true);
  });

  it("returns true for numbers", () => {
    expect(hasTranslatableContent("12345")).toBe(true);
  });

  it("returns true for mixed content", () => {
    expect(hasTranslatableContent("Hello 안녕 123")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(hasTranslatableContent("")).toBe(false);
  });

  it("returns false for whitespace only", () => {
    expect(hasTranslatableContent("   ")).toBe(false);
  });

  it("returns false for symbols only", () => {
    expect(hasTranslatableContent("!@#$%^&*()")).toBe(false);
  });

  it("returns false for punctuation only", () => {
    expect(hasTranslatableContent("...???!!!")).toBe(false);
  });
});

describe("resolveDirection", () => {
  it("returns fixed direction when not auto", () => {
    expect(resolveDirection("any text", "ko-en")).toBe("ko-en");
    expect(resolveDirection("any text", "en-ko")).toBe("en-ko");
  });

  it("detects Korean text and returns ko-en", () => {
    expect(resolveDirection("안녕하세요", "auto")).toBe("ko-en");
    expect(resolveDirection("Hello 안녕", "auto")).toBe("ko-en");
  });

  it("detects English text and returns en-ko", () => {
    expect(resolveDirection("Hello world", "auto")).toBe("en-ko");
    expect(resolveDirection("This is a test", "auto")).toBe("en-ko");
  });

  it("defaults to en-ko for non-Korean text", () => {
    expect(resolveDirection("12345", "auto")).toBe("en-ko");
    expect(resolveDirection("", "auto")).toBe("en-ko");
  });
});

describe("extractSentences", () => {
  it("extracts sentence ending with period", () => {
    const result = extractSentences("Hello world.");
    expect(result.sentences).toEqual(["Hello world."]);
    expect(result.remainder).toBe("");
  });

  it("extracts sentence ending with question mark", () => {
    const result = extractSentences("How are you?");
    expect(result.sentences).toEqual(["How are you?"]);
    expect(result.remainder).toBe("");
  });

  it("extracts sentence ending with exclamation", () => {
    const result = extractSentences("Great job!");
    expect(result.sentences).toEqual(["Great job!"]);
    expect(result.remainder).toBe("");
  });

  it("handles Korean sentence markers", () => {
    const result = extractSentences("안녕하세요。");
    expect(result.sentences).toEqual(["안녕하세요。"]);
  });

  it("extracts multiple sentences", () => {
    const result = extractSentences("First. Second! Third?");
    expect(result.sentences).toEqual(["First.", "Second!", "Third?"]);
    expect(result.remainder).toBe("");
  });

  it("returns remainder for incomplete sentence", () => {
    const result = extractSentences("Hello world");
    expect(result.sentences).toEqual([]);
    expect(result.remainder).toBe("Hello world");
  });

  it("handles mixed complete and incomplete sentences", () => {
    const result = extractSentences("Complete sentence. Incomplete");
    expect(result.sentences).toEqual(["Complete sentence."]);
    expect(result.remainder).toBe(" Incomplete");
  });

  it("handles newline as sentence boundary", () => {
    const result = extractSentences("First line\nSecond line");
    expect(result.sentences).toEqual(["First line"]);
    expect(result.remainder).toBe("Second line");
  });

  it("filters out non-translatable content", () => {
    const result = extractSentences("...\nHello.");
    expect(result.sentences).toEqual(["Hello."]);
  });

  it("handles empty input", () => {
    const result = extractSentences("");
    expect(result.sentences).toEqual([]);
    expect(result.remainder).toBe("");
  });
});
