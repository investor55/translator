import { streamText, tool, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import type {
  AgentStep,
  Agent,
  AgentQuestionRequest,
  AgentQuestionSelection,
} from "../types";
import { log } from "../logger";
import {
  getAgentInitialUserPromptTemplate,
  getAgentSystemPromptTemplate,
  renderPromptTemplate,
} from "../prompt-loader";

type ExaClient = {
  searchAndContents: (query: string, options: Record<string, unknown>) => Promise<{
    results: Array<{ title: string; url: string; text?: string }>;
  }>;
};

type AgentDeps = {
  model: Parameters<typeof streamText>[0]["model"];
  exa: ExaClient;
  getTranscriptContext: () => string;
  requestClarification: (
    request: AgentQuestionRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal },
  ) => Promise<AgentQuestionSelection[]>;
  onStep: (step: AgentStep) => void;
  onComplete: (result: string, messages: ModelMessage[]) => void;
  onFail: (error: string) => void;
  abortSignal?: AbortSignal;
};

const FORCE_ASK_QUESTION_TEST = process.env.AGENT_FORCE_QUESTION_TEST !== "0";
const FORCED_QUESTION_MARKER = "[forced-ask-question-test-v1]";

const askQuestionInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  questions: z.array(
    z.object({
      id: z.string().trim().min(1),
      prompt: z.string().trim().min(1),
      options: z.array(
        z.object({
          id: z.string().trim().min(1),
          label: z.string().trim().min(1),
        })
      ).min(2).max(8),
      allow_multiple: z.boolean().optional(),
    })
  ).min(1).max(3),
});

function formatCurrentDateForPrompt(now: Date): string {
  const longDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  return `${longDate} (ISO: ${now.toISOString().slice(0, 10)})`;
}

const buildSystemPrompt = (transcriptContext: string) =>
  renderPromptTemplate(getAgentSystemPromptTemplate(), {
    today: formatCurrentDateForPrompt(new Date()),
    transcript_context: transcriptContext,
  });

export function buildAgentInitialUserPrompt(task: string, taskContext?: string): string {
  const contextText = taskContext?.trim();
  const contextSection = contextText ? `\n\nContext:\n${contextText}` : "";
  return renderPromptTemplate(getAgentInitialUserPromptTemplate(), {
    todo: task.trim(),
    context_section: contextSection,
  });
}

function buildTools(
  exa: ExaClient,
  getTranscriptContext: () => string,
  requestClarification: AgentDeps["requestClarification"],
) {
  return {
    searchWeb: tool({
      description:
        "Search the web for information when external facts are required. Use specific, targeted queries.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
      }),
      execute: async ({ query }) => {
        const results = await exa.searchAndContents(query, {
          type: "auto",
          numResults: 5,
          text: { maxCharacters: 1500 },
        });

        const formatted = results.results
          .map((r) => `**${r.title}** (${r.url})\n${r.text ?? ""}`)
          .join("\n\n---\n\n");

        return formatted;
      },
    }),
    getTranscriptContext: tool({
      description: "Get recent transcript blocks from the current conversation for more context.",
      inputSchema: z.object({}),
      execute: async () => {
        return getTranscriptContext();
      },
    }),
    askQuestion: tool({
      description:
        "Ask the user one or more multiple-choice clarification questions when intent is ambiguous. Wait for human responses before continuing.",
      inputSchema: askQuestionInputSchema,
      execute: async (input, { toolCallId, abortSignal }) => {
        const answers = await requestClarification(input, { toolCallId, abortSignal });
        return {
          title: input.title,
          questions: input.questions,
          answers,
        };
      },
    }),
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getSearchQuery(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const query = (input as Record<string, unknown>).query;
  return typeof query === "string" ? query.trim() || null : null;
}

function parseAskQuestionInput(input: unknown): AgentQuestionRequest | null {
  const parsed = askQuestionInputSchema.safeParse(input);
  if (!parsed.success) return null;
  return parsed.data;
}

function getAskQuestionAnswerCount(output: unknown): number {
  if (!output || typeof output !== "object") return 0;
  const answers = (output as Record<string, unknown>).answers;
  if (!Array.isArray(answers)) return 0;
  return answers.length;
}

function hasForcedQuestionMarker(messages: ModelMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "user") return false;
    const content = message.content;
    if (typeof content === "string") {
      return content.includes(FORCED_QUESTION_MARKER);
    }
    try {
      return JSON.stringify(content).includes(FORCED_QUESTION_MARKER);
    } catch {
      return false;
    }
  });
}

function buildForcedQuestionRequest(agent: Agent): AgentQuestionRequest {
  const taskSummary = agent.task.trim().slice(0, 120);
  return {
    title: "Quick Clarification",
    questions: [
      {
        id: "approach",
        prompt: taskSummary
          ? `For this task: "${taskSummary}", how should I proceed first?`
          : "How should I proceed first?",
        options: [
          { id: "web-first", label: "Use web research first (Recommended)" },
          { id: "transcript-first", label: "Use transcript/context first, then web only if needed" },
          { id: "ask-more", label: "Ask more follow-up questions before researching" },
        ],
      },
    ],
  };
}

function formatForcedQuestionAnswers(
  request: AgentQuestionRequest,
  answers: AgentQuestionSelection[],
): string {
  const selectedByQuestionId = new Map(
    answers.map((answer) => [answer.questionId, new Set(answer.selectedOptionIds)])
  );
  const lines = request.questions.map((question) => {
    const selected = selectedByQuestionId.get(question.id) ?? new Set<string>();
    const labels = question.options
      .filter((option) => selected.has(option.id))
      .map((option) => option.label);
    return `- ${question.prompt}\n  Answer: ${labels.length > 0 ? labels.join(", ") : "No selection"}`;
  });
  return `${FORCED_QUESTION_MARKER}\nClarification answers:\n${lines.join("\n")}`;
}

async function applyForcedClarificationStep(
  agent: Agent,
  inputMessages: ModelMessage[],
  deps: Pick<AgentDeps, "requestClarification" | "onStep" | "abortSignal">,
): Promise<ModelMessage[]> {
  if (!FORCE_ASK_QUESTION_TEST) return inputMessages;
  if (hasForcedQuestionMarker(inputMessages)) return inputMessages;

  const request = buildForcedQuestionRequest(agent);
  const toolCallId = `forced-ask:${crypto.randomUUID()}`;
  const createdAt = Date.now();

  deps.onStep({
    id: `tool:${toolCallId}`,
    kind: "tool-call",
    content: "Needs clarification (1 question)",
    toolName: "askQuestion",
    toolInput: safeJson(request),
    createdAt,
  });

  const answers = await deps.requestClarification(request, {
    toolCallId,
    abortSignal: deps.abortSignal,
  });
  const output = {
    title: request.title,
    questions: request.questions,
    answers,
  };
  deps.onStep({
    id: `tool:${toolCallId}`,
    kind: "tool-result",
    content: `Clarification received (${answers.length} answered)`,
    toolName: "askQuestion",
    toolInput: safeJson(output),
    createdAt: Date.now(),
  });

  const answerSummary = formatForcedQuestionAnswers(request, answers);
  return [...inputMessages, { role: "user", content: answerSummary }];
}

function summarizeToolCall(toolName: string, input: unknown): {
  content: string;
  toolInput?: string;
} {
  if (toolName === "searchWeb") {
    const query = getSearchQuery(input);
    if (query) {
      return { content: `Searched: ${query}` };
    }
    return { content: "Searching the web", toolInput: safeJson(input) };
  }

  if (toolName === "getTranscriptContext") {
    return { content: "Reading transcript context" };
  }

  if (toolName === "askQuestion") {
    const request = parseAskQuestionInput(input);
    if (request) {
      const count = request.questions.length;
      return {
        content: `Needs clarification (${count} question${count === 1 ? "" : "s"})`,
        toolInput: safeJson(request),
      };
    }
    return { content: "Needs clarification", toolInput: safeJson(input) };
  }

  return {
    content: `Using ${toolName}`,
    toolInput: safeJson(input),
  };
}

function summarizeToolResult(
  toolName: string,
  input: unknown,
  output: unknown
): {
  content: string;
  toolInput?: string;
} {
  if (toolName === "searchWeb") {
    const query = getSearchQuery(input);
    if (query) {
      return { content: `Searched: ${query}` };
    }
    return { content: "Search complete" };
  }

  if (toolName === "getTranscriptContext") {
    return { content: "Loaded transcript context" };
  }

  if (toolName === "askQuestion") {
    const count = getAskQuestionAnswerCount(output);
    return {
      content:
        count > 0
          ? `Clarification received (${count} answered)`
          : "Clarification received",
      toolInput: safeJson(output),
    };
  }

  return {
    content: `${toolName} complete`,
    toolInput: safeJson(output),
  };
}

/**
 * Run agent with an initial prompt (first turn).
 */
export async function runAgent(agent: Agent, deps: AgentDeps): Promise<void> {
  const initialPrompt = buildAgentInitialUserPrompt(agent.task, agent.taskContext);
  const inputMessages: ModelMessage[] = [{ role: "user", content: initialPrompt }];
  await runAgentWithMessages(agent, inputMessages, deps);
}

/**
 * Continue an agent conversation with existing messages + a new user question.
 */
export async function continueAgent(
  agent: Agent,
  previousMessages: ModelMessage[],
  followUpQuestion: string,
  deps: AgentDeps,
): Promise<void> {
  const inputMessages: ModelMessage[] = [
    ...previousMessages,
    { role: "user", content: followUpQuestion },
  ];
  await runAgentWithMessages(agent, inputMessages, deps);
}

async function runAgentWithMessages(
  agent: Agent,
  inputMessages: ModelMessage[],
  deps: AgentDeps,
): Promise<void> {
  const {
    model,
    exa,
    getTranscriptContext,
    requestClarification,
    onStep,
    onComplete,
    onFail,
    abortSignal,
  } = deps;

  try {
    const effectiveInputMessages = await applyForcedClarificationStep(agent, inputMessages, {
      requestClarification,
      onStep,
      abortSignal,
    });
    const systemPrompt = buildSystemPrompt(getTranscriptContext());
    const tools = buildTools(exa, getTranscriptContext, requestClarification);

    const result = streamText({
      model,
      system: systemPrompt,
      messages: effectiveInputMessages,
      stopWhen: stepCountIs(8),
      abortSignal,
      tools,
    });

    const streamedAt = Date.now();
    let textStepId: string | null = null;
    let streamedText = "";
    let deltaCount = 0;
    let firstDeltaAfterMs: number | null = null;
    const reasoningById = new Map<string, string>();

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": {
          deltaCount += 1;
          if (firstDeltaAfterMs == null) {
            firstDeltaAfterMs = Date.now() - streamedAt;
          }
          streamedText += part.text;
          textStepId = `text:${part.id}`;
          onStep({
            id: textStepId,
            kind: "text",
            content: streamedText,
            createdAt: streamedAt,
          });
          break;
        }
        case "reasoning-start": {
          const reasoningStepId = `reasoning:${part.id}`;
          onStep({
            id: reasoningStepId,
            kind: "thinking",
            content: "Thinking...",
            createdAt: Date.now(),
          });
          break;
        }
        case "reasoning-delta": {
          const reasoningStepId = `reasoning:${part.id}`;
          const next = `${reasoningById.get(reasoningStepId) ?? ""}${part.text}`;
          reasoningById.set(reasoningStepId, next);
          onStep({
            id: reasoningStepId,
            kind: "thinking",
            content: next.trim() || "Thinking...",
            createdAt: Date.now(),
          });
          break;
        }
        case "tool-call": {
          const { content, toolInput } = summarizeToolCall(part.toolName, part.input);
          const toolStepId = `tool:${part.toolCallId}`;
          onStep({
            id: toolStepId,
            kind: "tool-call",
            content,
            toolName: part.toolName,
            toolInput,
            createdAt: Date.now(),
          });
          break;
        }
        case "tool-result": {
          if (part.preliminary) break;
          const { content, toolInput } = summarizeToolResult(
            part.toolName,
            part.input,
            part.output
          );
          const toolStepId = `tool:${part.toolCallId}`;
          onStep({
            id: toolStepId,
            kind: "tool-result",
            content,
            toolName: part.toolName,
            toolInput,
            createdAt: Date.now(),
          });
          break;
        }
        case "tool-error": {
          const toolStepId = `tool:${part.toolCallId}`;
          onStep({
            id: toolStepId,
            kind: "tool-result",
            content: `${part.toolName} failed`,
            toolName: part.toolName,
            toolInput: safeJson(part.error),
            createdAt: Date.now(),
          });
          break;
        }
        default: {
          break;
        }
      }
    }

    const finalText = (await result.text).trim() || streamedText || "No results found.";
    const finalStepId = textStepId ?? crypto.randomUUID();
    onStep({
      id: finalStepId,
      kind: "text",
      content: finalText,
      createdAt: streamedAt,
    });

    // Build full conversation history for future follow-ups
    const response = await result.response;
    const fullHistory = [...effectiveInputMessages, ...response.messages];
    log(
      "INFO",
      `Agent stream ${agent.id}: deltas=${deltaCount}, firstDeltaMs=${firstDeltaAfterMs ?? -1}, totalMs=${Date.now() - streamedAt}`
    );
    onComplete(finalText, fullHistory);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      onFail("Cancelled");
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    onFail(message);
  }
}
