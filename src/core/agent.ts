import { streamText, tool, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import type { AgentStep, Agent } from "./types";
import { log } from "./logger";

type ExaClient = {
  searchAndContents: (query: string, options: Record<string, unknown>) => Promise<{
    results: Array<{ title: string; url: string; text?: string }>;
  }>;
};

type AgentDeps = {
  model: Parameters<typeof streamText>[0]["model"];
  exa: ExaClient;
  getTranscriptContext: () => string;
  onStep: (step: AgentStep) => void;
  onComplete: (result: string, messages: ModelMessage[]) => void;
  onFail: (error: string) => void;
  abortSignal?: AbortSignal;
};

const buildSystemPrompt = (transcriptContext: string) =>
  `You are a helpful research agent. Your task is to research the following and provide a concise, actionable answer.

Conversation context from the current session:
${transcriptContext}

Instructions:
- Use the searchWeb tool to find relevant information
- Use the getTranscriptContext tool if you need more conversation context
- Be concise — aim for 2-4 sentences in your final answer
- Cite sources with URLs when possible
- Focus on actionable, specific results (e.g., specific restaurant names, addresses, hours)`;

function buildTools(exa: ExaClient, getTranscriptContext: () => string) {
  return {
    searchWeb: tool({
      description: "Search the web for information. Use specific, targeted queries.",
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

  return {
    content: `${toolName} complete`,
    toolInput: safeJson(output),
  };
}

/**
 * Run agent with an initial prompt (first turn).
 */
export async function runAgent(agent: Agent, deps: AgentDeps): Promise<void> {
  const initialPrompt = agent.taskContext?.trim()
    ? `${agent.task}\n\nAdditional context:\n${agent.taskContext}`
    : agent.task;
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
  const { model, exa, getTranscriptContext, onStep, onComplete, onFail, abortSignal } = deps;

  const systemPrompt = buildSystemPrompt(getTranscriptContext());
  const tools = buildTools(exa, getTranscriptContext);

  try {
    const result = streamText({
      model,
      system: systemPrompt,
      messages: inputMessages,
      stopWhen: stepCountIs(5),
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
    const fullHistory = [...inputMessages, ...response.messages];
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
