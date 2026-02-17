import { z } from "zod";
import type { TranscriptBlock, TodoItem, InsightKind } from "./types";

export const analysisSchema = z.object({
  keyPoints: z
    .array(z.string())
    .describe("3-5 key points from the recent conversation. Concise, one sentence each."),
  actionItems: z
    .array(
      z.object({
        text: z.string().describe("The action item or insight text"),
        kind: z
          .enum(["action-item", "decision", "question", "key-point"])
          .describe("The classification of this item"),
      })
    )
    .describe("Action items, decisions, questions, or key points extracted from the conversation"),
  suggestedTodos: z
    .array(z.string())
    .describe("Concrete follow-up tasks suggested from the conversation. Only include clear, actionable items. Empty array if none."),
});

export type AnalysisResult = z.infer<typeof analysisSchema>;

export function buildAnalysisPrompt(
  recentBlocks: TranscriptBlock[],
  existingTodos: ReadonlyArray<Pick<TodoItem, "text" | "completed">>,
  previousKeyPoints: readonly string[]
): string {
  const transcript = recentBlocks
    .map((b) => {
      const source = `[${b.audioSource}] ${b.sourceLabel}: ${b.sourceText}`;
      const translation = b.translation ? ` → ${b.targetLabel}: ${b.translation}` : "";
      return source + translation;
    })
    .join("\n");

  const todosSection =
    existingTodos.length > 0
      ? `\n\nExisting todos:\n${existingTodos.map((t) => `- [${t.completed ? "x" : " "}] ${t.text}`).join("\n")}`
      : "";

  const keyPointsSection =
    previousKeyPoints.length > 0
      ? `\n\nPrevious key points from this session:\n${previousKeyPoints.map((p) => `- ${p}`).join("\n")}`
      : "";

  return `Analyze this recent conversation transcript and extract structured insights.

Recent transcript:
${transcript}${todosSection}${keyPointsSection}

Instructions:
- Extract 3-5 key points summarizing what was discussed
- Identify any action items, decisions made, questions raised, or important points
- Suggest concrete follow-up todos only if clearly actionable items were mentioned
- Do NOT duplicate existing todos
- Keep all text concise and actionable`;
}
