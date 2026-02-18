import { z } from "zod";
import type { TranscriptBlock, TodoItem } from "../types";
import {
  getAnalysisRequestPromptTemplate,
  getInsightsSystemPrompt,
  getSummarySystemPrompt,
  getTodoExtractPromptTemplate,
  getTodoFromSelectionPromptTemplate,
  renderPromptTemplate,
} from "../prompt-loader";

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
    .array(
      z.union([
        z.string().describe("Legacy fallback: short actionable todo title."),
        z.object({
          todoTitle: z
            .string()
            .describe("Short actionable todo title (3-10 words)."),
          todoDetails: z
            .string()
            .describe("Rich context and constraints for autonomous execution."),
          transcriptExcerpt: z
            .string()
            .describe("Short verbatim transcript excerpt grounding this todo.")
            .optional(),
        }),
      ]),
    )
    .describe("Clear action items from the conversation. Prefer structured items with title, details, and supporting excerpt."),
});

export const todoFromSelectionSchema = z.object({
  shouldCreateTodo: z
    .boolean()
    .describe("Whether the selected text contains a clear, actionable todo."),
  todoTitle: z
    .string()
    .describe("Short actionable todo title (3-10 words). Empty when shouldCreateTodo is false."),
  todoDetails: z
    .string()
    .describe("Detailed context for the todo preserving specifics, constraints, names, and timeline. Empty when shouldCreateTodo is false."),
  reason: z
    .string()
    .describe("Brief explanation for decision."),
});

export type AnalysisResult = z.infer<typeof analysisSchema>;
export type TodoAnalysisResult = z.infer<typeof todoAnalysisSchema>;
export type TodoExtractSuggestion = TodoAnalysisResult["suggestedTodos"][number];
export type TodoFromSelectionResult = z.infer<typeof todoFromSelectionSchema>;

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

  return renderPromptTemplate(getAnalysisRequestPromptTemplate(), {
    summary_system_prompt: summarySystemPrompt,
    insights_system_prompt: insightsSystemPrompt,
    transcript,
    previous_key_points_section: keyPointsSection,
  });
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

  return renderPromptTemplate(getTodoExtractPromptTemplate(), {
    transcript,
    existing_todos_section: todosSection,
  });
}

export function buildTodoFromSelectionPrompt(
  selectedText: string,
  existingTodos: ReadonlyArray<Pick<TodoItem, "text" | "completed">>,
  userIntentText?: string,
): string {
  const todosSection =
    existingTodos.length > 0
      ? `\n\nExisting todos:\n${existingTodos.map((t) => `- [${t.completed ? "x" : " "}] ${t.text}`).join("\n")}`
      : "";
  const intent = userIntentText?.trim() ?? "";
  const userIntentSection = intent
    ? `\n\nUser intent for todo creation:\n${intent}`
    : "";

  return renderPromptTemplate(getTodoFromSelectionPromptTemplate(), {
    selected_text: selectedText,
    user_intent_section: userIntentSection,
    existing_todos_section: todosSection,
  });
}
