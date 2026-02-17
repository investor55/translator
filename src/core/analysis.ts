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
    .describe("Clear action items from the conversation. Include explicit tasks and concrete planning intents, but skip vague chatter."),
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
- Suggest todos when there is explicit intent, commitment, or concrete planning (for example: "I need to", "we should", "add a todo", "remind me to", "don't forget to", "I'm planning to", "I'm going to", "I'm looking to", "I want to", "I wanna").
- Treat first-person planning statements as actionable TODOs even when dates are not fixed yet.
- Treat travel planning and scheduling intent as TODOs (for example: "I'm planning to visit X", "we should decide where else to go", "need to book X").
- Skip vague brainstorming and informational statements without a clear next action.
- Ignore bracketed non-speech tags like [silence], [music], [noise], [laughs].
- Preserve details exactly: names, places, dates, times, constraints.
- Merge fragments across neighboring lines into one complete todo.
- Rewrite each todo as a short imperative action phrase.
- Do NOT duplicate existing todos.
- Return an empty list when no clear actionable todo was discussed.`;
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

  return `You convert highlighted transcript text into one concrete TODO.

Highlighted transcript:
${selectedText}${userIntentSection}${todosSection}

Task:
- Treat the highlighted transcript as grounding context.
- If user intent is provided, prioritize it and convert it into one short imperative todo that is consistent with context.
- If no user intent is provided, decide whether the highlighted text contains a clear actionable commitment, follow-up, or planning intent.
- Return both:
  - todoTitle: concise action title.
  - todoDetails: rich context and constraints needed by an autonomous agent, including relevant background, assumptions, scope boundaries, and success criteria.
- Preserve critical details (names, places, dates, constraints).
- Do not create a todo when the text is unclear, conversational filler, or non-actionable.
- Do not duplicate an existing todo.
- Return empty todoTitle and todoDetails when shouldCreateTodo is false.`;
}
