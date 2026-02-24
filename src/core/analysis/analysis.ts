import { z } from "zod";
import type { TranscriptBlock, TaskItem, Agent } from "../types";
import {
  getAgentSuggestionPromptTemplate,
  getAnalysisRequestPromptTemplate,
  getSummarySystemPrompt,
  getTaskCreationSharedPromptTemplate,
  getTaskFromSelectionPromptTemplate,
  renderPromptTemplate,
} from "../prompt-loader";

export const analysisSchema = z.object({
  keyPoints: z
    .array(z.string())
    .describe("2-4 key points from the recent conversation. Each must be a specific, verifiable fact. One sentence each."),
});

export const agentSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        kind: z
          .enum(["research", "action", "insight", "flag", "followup"])
          .describe("research = offer to look something up; action = offer to draft/create/do; insight = share a relevant fact as a question; flag = highlight a conflict or risk; followup = remind about a loose thread"),
        text: z
          .string()
          .describe("Conversational offer phrased as a question the agent can act on (e.g. 'Want me to look up X?', 'Should I draft Y?')."),
        details: z
          .string()
          .describe("Brief context or rationale for the suggestion.")
          .optional(),
        transcriptExcerpt: z
          .string()
          .describe("Short verbatim transcript excerpt grounding this suggestion.")
          .optional(),
      }),
    )
    .describe("0-3 proactive agent suggestions. Each must be something the agent can actually DO if accepted."),
});

/** @deprecated Use agentSuggestionSchema instead */
export const taskAnalysisSchema = agentSuggestionSchema;

export const taskFromSelectionSchema = z.object({
  shouldCreateTask: z
    .boolean()
    .describe("Whether a task should be created. Always true when user intent is provided. When no intent is given, true only if the selected text itself contains a clear actionable commitment."),
  taskTitle: z
    .string()
    .describe("Short actionable task title (3-10 words). Empty when shouldCreateTask is false."),
  taskDetails: z
    .string()
    .describe("Detailed context for the task preserving specifics, constraints, names, and timeline. Empty when shouldCreateTask is false."),
  reason: z
    .string()
    .describe("Brief explanation for decision."),
});

export const sessionTitleSchema = z.object({
  title: z.string().describe(
    "A concise 3-6 word title capturing the main topic or purpose of this conversation. No quotes. No filler like 'Discussion about'."
  ),
});

export function buildSessionTitlePrompt(excerpt: string): string {
  return `Generate a short, descriptive title (3-6 words) for a conversation based on this excerpt:\n\n${excerpt}\n\nFocus on the specific topic, not generic labels.`;
}

export const agentTitleSchema = z.object({
  title: z.string().describe(
    "A concise 3-6 word title for this agent task. No quotes. No filler like 'Task to' or 'Agent for'."
  ),
});

export function buildAgentTitlePrompt(task: string): string {
  return `Generate a short, descriptive title (3-6 words) for an AI agent task based on this prompt:\n\n${task.slice(0, 500)}\n\nBe specific about what is being done. No quotes.`;
}

const todoItemSchema = z.object({
  text: z.string().describe("The todo. Atomic, imperative, under 12 words, starting with a strong verb."),
  doer: z.enum(["agent", "human"]).describe(
    "'agent' if completable by an AI with web search, transcript search, and MCP tools (Notion, Linear). 'human' if it requires personal memory, physical action, or context not in the transcript."
  ),
});

export const finalSummarySchema = z.object({
  narrative: z.string().describe(
    "Markdown snapshot of the meeting in 2-4 concise sentences. No code fences."
  ),
  agreements: z.array(z.string()).describe(
    "Explicit agreements, decisions, or commitments reached in the meeting. 0-8 items. Each item one concise sentence."
  ),
  missedItems: z.array(z.string()).describe(
    "Important gaps, blind spots, assumptions, or things the team likely missed. 0-6 items. Empty array if none."
  ),
  unansweredQuestions: z.array(z.string()).describe(
    "Open unresolved questions from the meeting. 0-8 items. Empty array if none."
  ),
  agreementTodos: z.array(todoItemSchema).describe(
    "For agreements that exist, provide 1-3 concrete follow-up todos tied specifically to those agreements. Empty array if no agreements."
  ),
  missedItemTodos: z.array(todoItemSchema).describe(
    "For missedItems that exist, provide 1-3 concrete todos to close gaps or blind spots. Empty array if no missedItems."
  ),
  unansweredQuestionTodos: z.array(todoItemSchema).describe(
    "For unansweredQuestions that exist, provide 1-3 concrete investigation/decision todos to resolve them. Empty array if no unansweredQuestions."
  ),
  actionItems: z.array(todoItemSchema).describe(
    "Cross-cutting concrete action items not already captured in section-specific todos. Empty array if none."
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
    "Atomic follow-up todos. Each under 12 words, imperative, starting with a strong verb (e.g. 'Retest with paid API plan', 'Benchmark speed against Claude Opus'). No compound actions. Empty array if none."
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

  return `You are producing a final summary of a completed conversation that was transcribed and translated in real-time.

Output requirements:
- Return JSON matching the schema exactly.
- Keep every field concrete and specific to this transcript.
- "narrative": 2-4 sentence Markdown snapshot only.
- "agreements": capture explicit decisions/agreements that were reached.
- "missedItems": include likely blind spots and what was not discussed enough.
- "unansweredQuestions": include unresolved questions that still need answers.
- "agreementTodos": include a few follow-up todos tied to agreements.
- "missedItemTodos": include a few corrective/validation todos for missed items.
- "unansweredQuestionTodos": include a few investigation/decision todos for open questions.
- Every todo must be a single atomic action a single agent can complete in one focused pass.
- Keep each todo under 12 words and start with a strong verb.
- Do not chain actions with "and", commas, or slash-separated tasks.
- If a section has entries, provide at least 1 todo for that section.
- If a section has no entries, use an empty todo array for that section.
- "actionItems": only cross-cutting todos not already in the three section todo lists.
- Use empty arrays instead of inventing content when unsure.
- Do not include code fences.

Classifying "doer" for each todo:
- "agent": the task can be completed by an AI agent that can search the web, search transcript/agent history, ask the user clarifying questions, and call MCP tools (Notion, Linear).
- "human": the task requires personal memory, physical action, calendar scheduling, phone calls, or context not present in the transcript.
- When unsure, default to "human".

Full transcript:
${transcript || "(No transcript available)"}${keyPointsSection}`;
}

export type AnalysisResult = z.infer<typeof analysisSchema>;
export type AgentSuggestionResult = z.infer<typeof agentSuggestionSchema>;
export type AgentSuggestionItem = AgentSuggestionResult["suggestions"][number];
/** @deprecated Use AgentSuggestionResult instead */
export type TaskAnalysisResult = AgentSuggestionResult;
export type TaskFromSelectionResult = z.infer<typeof taskFromSelectionSchema>;

export function buildAnalysisPrompt(
  recentBlocks: TranscriptBlock[],
  previousKeyPoints: readonly string[],
): string {
  const summarySystemPrompt = getSummarySystemPrompt();

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
    transcript,
    previous_key_points_section: keyPointsSection,
  });
}

export function buildAgentSuggestionPrompt(
  recentBlocks: TranscriptBlock[],
  existingTasks: ReadonlyArray<Pick<TaskItem, "text" | "completed">>,
  historicalSuggestions: readonly string[] = [],
  keyPoints: readonly string[] = [],
  educationalContext: readonly string[] = [],
): string {
  const transcript = recentBlocks
    .map((b) => {
      const source = `[${b.audioSource}] ${b.sourceText}`;
      const translation = b.translation ? ` → ${b.translation}` : "";
      return source + translation;
    })
    .join("\n");

  const tasksSection =
    existingTasks.length > 0
      ? `\n\nExisting tasks:\n${existingTasks.map((t) => `- [${t.completed ? "x" : " "}] ${t.text}`).join("\n")}`
      : "";

  const historicalSuggestionsSet = new Set<string>();
  const normalizedHistory = historicalSuggestions
    .map((text) => text.trim())
    .filter(Boolean)
    .filter((text) => {
      const key = text.toLowerCase();
      if (historicalSuggestionsSet.has(key)) return false;
      historicalSuggestionsSet.add(key);
      return true;
    })
    .slice(-20);
  const historicalSuggestionsSection = normalizedHistory.length > 0
    ? `\n\nHistorical suggestions already shown in this session:\n${normalizedHistory.map((text) => `- ${text}`).join("\n")}`
    : "";

  const keyPointsSection = keyPoints.length > 0
    ? `\n\nKey points from the conversation so far:\n${keyPoints.map((p) => `- ${p}`).join("\n")}`
    : "";

  const educationalSection = educationalContext.length > 0
    ? `\n\nPrior educational insights (use to inform suggestions, do not repeat):\n${educationalContext.map((text) => `- ${text}`).join("\n")}`
    : "";

  return renderPromptTemplate(getAgentSuggestionPromptTemplate(), {
    transcript,
    existing_tasks_section: tasksSection,
    historical_suggestions_section: historicalSuggestionsSection,
    key_points_section: keyPointsSection,
    educational_context_section: educationalSection,
  });
}

/** @deprecated Use buildAgentSuggestionPrompt instead */
export const buildTaskPrompt = buildAgentSuggestionPrompt;

export function buildTaskFromSelectionPrompt(
  selectedText: string,
  existingTasks: ReadonlyArray<Pick<TaskItem, "text" | "completed">>,
  userIntentText?: string,
): string {
  const tasksSection =
    existingTasks.length > 0
      ? `\n\nExisting tasks:\n${existingTasks.map((t) => `- [${t.completed ? "x" : " "}] ${t.text}`).join("\n")}`
      : "";
  const intent = userIntentText?.trim() ?? "";
  const userIntentSection = intent
    ? `\n\nUser intent for task creation:\n${intent}`
    : "";

  return renderPromptTemplate(getTaskFromSelectionPromptTemplate(), {
    selected_text: selectedText,
    user_intent_section: userIntentSection,
    existing_tasks_section: tasksSection,
    task_creation_shared_rules: getTaskCreationSharedPromptTemplate(),
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
    "",
    "Rules for nextSteps:",
    "- Every next step must be a single atomic action a single agent can complete in one focused pass.",
    "- Keep each next step under 12 words and start with a strong verb.",
    "- Do not chain actions with 'and', commas, or slash-separated tasks.",
  ].join("\n");
}
