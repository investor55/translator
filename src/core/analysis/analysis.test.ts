import { describe, expect, it } from "vitest";
import { buildAnalysisPrompt, buildAgentSuggestionPrompt, buildTaskFromSelectionPrompt } from "./analysis";
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
    );
    expect(prompt).toContain("[system] I want to visit Austin next month.");
    expect(prompt).toContain("Previous key points from this session:");
    expect(prompt).toContain("Grounding requirements:");
    expect(prompt).toContain("Do not use memory from prior sessions.");
  });
});

describe("buildAgentSuggestionPrompt", () => {
  it("includes transcript and existing tasks", () => {
    const prompt = buildAgentSuggestionPrompt(SAMPLE_BLOCKS, [{ text: "Book flights", completed: false }]);
    expect(prompt).toContain("[system] I want to visit Austin next month.");
    expect(prompt).toContain("Existing tasks:");
    expect(prompt).toContain("[ ] Book flights");
    expect(prompt).toContain("kind");
    expect(prompt).toContain("text");
    expect(prompt).toContain("transcriptExcerpt");
  });

  it("includes historical suggestions context", () => {
    const prompt = buildAgentSuggestionPrompt(
      SAMPLE_BLOCKS,
      [{ text: "Book flights", completed: false }],
      ["Research neighborhoods in Austin", "Dive into whether to rent a car?"],
    );
    expect(prompt).toContain("Historical suggestions already shown in this session:");
    expect(prompt).toContain("- Research neighborhoods in Austin");
    expect(prompt).toContain("- Dive into whether to rent a car?");
  });

  it("includes key points and educational context when provided", () => {
    const prompt = buildAgentSuggestionPrompt(
      SAMPLE_BLOCKS,
      [],
      [],
      ["Plan trip dates"],
      ["Austin has major events that can affect hotel prices"],
    );
    expect(prompt).toContain("Key points from the conversation so far:");
    expect(prompt).toContain("- Plan trip dates");
    expect(prompt).toContain("Prior educational insights");
    expect(prompt).toContain("- Austin has major events that can affect hotel prices");
  });
});

describe("buildTaskFromSelectionPrompt", () => {
  it("includes shared task structure and user intent", () => {
    const prompt = buildTaskFromSelectionPrompt(
      "We should benchmark Gemini against Claude this week.",
      [{ text: "Book flights", completed: false }],
      "Focus on practical coding speed differences.",
    );

    expect(prompt).toContain("User intent for task creation:");
    expect(prompt).toContain("Focus on practical coding speed differences.");
    expect(prompt).toContain("Rough thinking:");
    expect(prompt).toContain("Rough plan:");
    expect(prompt).toContain("Questions for user:");
    expect(prompt).toContain("Done when:");
    expect(prompt).toContain("Constraints:");
  });
});
