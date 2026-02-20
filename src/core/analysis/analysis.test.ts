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
    const prompt = buildAnalysisPrompt(
      SAMPLE_BLOCKS,
      ["Plan trip dates"],
      ["Austin has major events that can affect hotel prices"],
    );
    expect(prompt).toContain("[system] I want to visit Austin next month.");
    expect(prompt).toContain("Previous key points from this session:");
    expect(prompt).toContain("Previous educational insights from this session:");
    expect(prompt).toContain("Grounding requirements:");
    expect(prompt).toContain("Do not use memory from prior sessions.");
    expect(prompt).toContain("avoid repeating the same insight");
  });
});

describe("buildTodoPrompt", () => {
  it("includes transcript and existing todos", () => {
    const prompt = buildTodoPrompt(SAMPLE_BLOCKS, [{ text: "Book flights", completed: false }]);
    expect(prompt).toContain("[system] I want to visit Austin next month.");
    expect(prompt).toContain("Existing todos:");
    expect(prompt).toContain("[ ] Book flights");
    expect(prompt).toContain("todoTitle");
    expect(prompt).toContain("todoDetails");
    expect(prompt).toContain("transcriptExcerpt");
  });

  it("includes historical suggestions context", () => {
    const prompt = buildTodoPrompt(
      SAMPLE_BLOCKS,
      [{ text: "Book flights", completed: false }],
      ["Research neighborhoods in Austin", "Dive into whether to rent a car?"],
    );
    expect(prompt).toContain("Historical suggestions already shown in this session:");
    expect(prompt).toContain("- Research neighborhoods in Austin");
    expect(prompt).toContain("- Dive into whether to rent a car?");
  });
});
