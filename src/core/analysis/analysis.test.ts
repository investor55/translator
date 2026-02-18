import { describe, expect, it } from "vitest";
import { buildAnalysisPrompt, buildTodoPrompt } from "./analysis";
import type { TranscriptBlock } from "../types";

const SAMPLE_BLOCKS: TranscriptBlock[] = [
  {
    id: 1,
    sourceLabel: "English",
    sourceText: "I want to visit Austin next month.",
    targetLabel: "Korean",
    translation: "다음 달에 오스틴을 방문하고 싶어요.",
    createdAt: 1,
    audioSource: "system",
  },
];

describe("buildAnalysisPrompt", () => {
  it("includes transcript content and session grounding rules", () => {
    const prompt = buildAnalysisPrompt(SAMPLE_BLOCKS, ["Plan trip dates"]);
    expect(prompt).toContain("[system] I want to visit Austin next month.");
    expect(prompt).toContain("Previous key points from this session:");
    expect(prompt).toContain("Grounding requirements:");
    expect(prompt).toContain("Do not use memory from prior sessions.");
  });
});

describe("buildTodoPrompt", () => {
  it("includes transcript and existing todos", () => {
    const prompt = buildTodoPrompt(SAMPLE_BLOCKS, [{ text: "Book flights", completed: false }]);
    expect(prompt).toContain("[system] I want to visit Austin next month.");
    expect(prompt).toContain("Existing todos:");
    expect(prompt).toContain("[ ] Book flights");
  });
});
