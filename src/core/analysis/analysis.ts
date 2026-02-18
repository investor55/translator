import { z } from "zod";
import type { TranscriptBlock, TodoItem, Agent } from "../types";
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
    .describe("Whether a todo should be created. Always true when user intent is provided. When no intent is given, true only if the selected text itself contains a clear actionable commitment."),
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

export const finalSummarySchema = z.object({
  narrative: z.string().describe(
    "A comprehensive 2-5 sentence prose summary of the full conversation covering main topics, decisions, and overall arc. Write in plain English."
  ),
  actionItems: z.array(z.string()).describe(
    "Concrete action items or commitments. Each a short imperative phrase (3-10 words). Empty array if none."
  ),
});

export type FinalSummaryResult = z.infer<typeof finalSummarySchema>;

export const agentsSummarySchema = z.object({
  overallNarrative: z.string().describe(
    "2-4 sentence prose debrief of what the agent fleet collectively accomplished. Focus on outcomes and synthesis across agents, not individual steps."
  ),
  agentHighlights: z.array(z.object({
    agentId: z.string().describe("Agent id, passed through unchanged."),
    task: z.string().describe("Agent's original task, passed through unchanged."),
    status: z.enum(["completed", "failed"]),
    keyFinding: z.string().describe(
      "1-2 sentence distillation of the most important finding or outcome. If failed, describe what was attempted and why."
    ),
  })).describe("One entry per agent. Do not omit failed agents."),
  coverageGaps: z.array(z.string()).describe(
    "Aspects of the objectives that remain unaddressed. Empty array if coverage is complete."
  ),
  nextSteps: z.array(z.string()).describe(
    "Specific actionable follow-up tasks suggested by collective findings. Short imperative phrases (3-10 words). Empty array if none."
  ),
});

export type AgentsSummaryResult = z.infer<typeof agentsSummarySchema>;

export function buildFinalSummaryPrompt(
  allBlocks: readonly TranscriptBlock[],
  allKeyPoints: readonly string[],
): string {
  const transcript = allBlocks
    .map((b) => {
      const line = `[${b.audioSource}] ${b.sourceText}`;
      return b.translation ? `${line} → ${b.translation}` : line;
    })
    .join("\n");

  const keyPointsSection = allKeyPoints.length > 0
    ? `\n\nKey points identified during the session:\n${allKeyPoints.map((p) => `- ${p}`).join("\n")}`
    : "";

  return `You are producing a final summary of a completed conversation that was transcribed and translated in real-time.\n\nFull transcript:\n${transcript || "(No transcript available)"}${keyPointsSection}`;
}

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

export function buildAgentsSummaryPrompt(
  agents: readonly Agent[],
  transcriptBlocks: readonly TranscriptBlock[] = [],
  keyPoints: readonly string[] = [],
): string {
  const terminal = agents.filter(
    (a) => a.status === "completed" || a.status === "failed"
  );
  const agentDocs = terminal.map((a) => {
    const tools = [...new Set(
      a.steps.filter((s) => s.kind === "tool-call" && s.toolName).map((s) => s.toolName!)
    )];
    const durationSecs = a.completedAt && a.createdAt
      ? Math.round((a.completedAt - a.createdAt) / 1000) : 0;
    return [
      `## Agent id:${a.id} — ${a.task}`,
      `Status: ${a.status} | Duration: ${durationSecs}s`,
      tools.length > 0 ? `Tools used: ${tools.join(", ")}` : null,
      a.taskContext ? `Context: ${a.taskContext}` : null,
      a.result ? `Result:\n${a.result}` : null,
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const succeeded = terminal.filter((a) => a.status === "completed").length;

  const transcriptSection = transcriptBlocks.length > 0
    ? [
        "",
        "Session transcript (source material the agents worked from):",
        transcriptBlocks.map((b) => {
          const line = `[${b.audioSource}] ${b.sourceText}`;
          return b.translation ? `${line} → ${b.translation}` : line;
        }).join("\n"),
      ].join("\n")
    : "";

  const keyPointsSection = keyPoints.length > 0
    ? [
        "",
        "Key points identified during the session:",
        keyPoints.map((p) => `- ${p}`).join("\n"),
      ].join("\n")
    : "";

  return [
    "You are producing a debrief of a completed multi-agent research session.",
    `Stats: ${terminal.length} agents · ${succeeded} succeeded · ${terminal.length - succeeded} failed`,
    transcriptSection,
    keyPointsSection,
    "",
    "Agent reports:",
    agentDocs,
    "",
    "Synthesize what was collectively learned, identify coverage gaps, and suggest next steps.",
  ].join("\n");
}
