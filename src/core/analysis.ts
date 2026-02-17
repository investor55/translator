import { z } from "zod";
import type { TranscriptBlock, TodoItem } from "./types";
import { getInsightsSystemPrompt, getSummarySystemPrompt } from "./prompt-loader";

export const analysisSchema = z.object({
  keyPoints: z
    .array(z.string())
    .describe("2-4 key points from the recent conversation. Each must be a specific, verifiable fact. One sentence each."),
  educationalInsights: z
    .array(
      z.object({
        text: z.string().describe("A concise educational note providing background knowledge about a topic mentioned in the conversation"),
        kind: z
          .enum(["definition", "context", "fact", "tip"])
          .describe("definition = explains a term or concept; context = provides relevant background; fact = interesting related fact; tip = practical advice related to the topic"),
      })
    )
    .describe("1-3 educational notes that help the listener understand topics mentioned in the conversation. Think of these as helpful footnotes."),
});

export const todoAnalysisSchema = z.object({
  suggestedTodos: z
    .array(z.string())
    .describe("Clear action items explicitly stated in the conversation. Only include concrete tasks someone committed to doing or requested to track."),
});

export type AnalysisResult = z.infer<typeof analysisSchema>;
export type TodoAnalysisResult = z.infer<typeof todoAnalysisSchema>;

export function buildAnalysisPrompt(
  recentBlocks: TranscriptBlock[],
  previousKeyPoints: readonly string[]
): string {
  const summarySystemPrompt = getSummarySystemPrompt();
  const insightsSystemPrompt = getInsightsSystemPrompt();

  const transcript = recentBlocks
    .map((b) => {
      const source = `[${b.audioSource}] ${b.sourceText}`;
      const translation = b.translation ? ` → ${b.translation}` : "";
      return source + translation;
    })
    .join("\n");

  const keyPointsSection =
    previousKeyPoints.length > 0
      ? `\n\nPrevious key points from this session:\n${previousKeyPoints.map((p) => `- ${p}`).join("\n")}`
      : "";

  return `${summarySystemPrompt}

${insightsSystemPrompt}

Recent transcript:
${transcript}${keyPointsSection}

Grounding requirements:
- Use only information from the transcript and previous key points from THIS session.
- Do not use memory from prior sessions.
- If transcript details are sparse, return fewer items rather than inventing details.
`;
}

export function buildTodoPrompt(
  recentBlocks: TranscriptBlock[],
  existingTodos: ReadonlyArray<Pick<TodoItem, "text" | "completed">>
): string {
  const transcript = recentBlocks
    .map((b) => {
      const source = `[${b.audioSource}] ${b.sourceText}`;
      const translation = b.translation ? ` → ${b.translation}` : "";
      return source + translation;
    })
    .join("\n");

  const todosSection =
    existingTodos.length > 0
      ? `\n\nExisting todos:\n${existingTodos.map((t) => `- [${t.completed ? "x" : " "}] ${t.text}`).join("\n")}`
      : "";

  return `You extract TODOs from live conversation transcripts.

Recent transcript:
${transcript}${todosSection}

Task:
- Extract only clear tasks, action items, or follow-ups.
- Suggest todos only when there is explicit intent or commitment (for example: "I need to", "we should", "add a todo", "remind me to", "don't forget to").
- Skip vague brainstorming, open-ended discussion, and informational statements without a clear next action.
- Preserve details exactly: names, places, dates, times, constraints.
- Merge fragments across neighboring lines into one complete todo.
- Do NOT duplicate existing todos.
- Return an empty list when no clear actionable todo was discussed.`;
}
