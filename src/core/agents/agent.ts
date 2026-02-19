import { streamText, tool, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import type {
  AgentStep,
  Agent,
  AgentQuestionRequest,
  AgentQuestionSelection,
  AgentToolApprovalRequest,
  AgentToolApprovalResponse,
} from "../types";
import { log } from "../logger";
import {
  getAgentInitialUserPromptTemplate,
  getAgentSystemPromptTemplate,
  renderPromptTemplate,
} from "../prompt-loader";
import type { AgentExternalToolSet } from "./external-tools";

type ExaClient = {
  search: (
    query: string,
    options: Record<string, unknown>
  ) => Promise<{
    results: Array<{ title: string; url: string; text?: string }>;
  }>;
};

type AgentDeps = {
  model: Parameters<typeof streamText>[0]["model"];
  exa: ExaClient;
  getTranscriptContext: () => string;
  projectInstructions?: string;
  getExternalTools?: () => Promise<AgentExternalToolSet>;
  allowAutoApprove: boolean;
  requestClarification: (
    request: AgentQuestionRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal }
  ) => Promise<AgentQuestionSelection[]>;
  requestToolApproval: (
    request: AgentToolApprovalRequest,
    options: { toolCallId: string; abortSignal?: AbortSignal }
  ) => Promise<AgentToolApprovalResponse>;
  onStep: (step: AgentStep) => void;
  onComplete: (result: string, messages: ModelMessage[]) => void;
  onFail: (error: string) => void;
  abortSignal?: AbortSignal;
};

const askQuestionInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  questions: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        prompt: z.string().trim().min(1),
        options: z
          .array(
            z.object({
              id: z.string().trim().min(1),
              label: z.string().trim().min(1),
            })
          )
          .min(2)
          .max(8),
        allow_multiple: z.boolean().optional(),
      })
    )
    .min(1)
    .max(3),
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

const buildSystemPrompt = (transcriptContext: string, projectInstructions?: string) => {
  const base = renderPromptTemplate(getAgentSystemPromptTemplate(), {
    today: formatCurrentDateForPrompt(new Date()),
    transcript_context: transcriptContext,
  });
  if (!projectInstructions?.trim()) return base;
  return `## Project Instructions\n\n${projectInstructions.trim()}\n\n---\n\n${base}`;
};

export function buildAgentInitialUserPrompt(
  task: string,
  taskContext?: string
): string {
  const contextText = taskContext?.trim();
  const contextSection = contextText ? `\n\nContext:\n${contextText}` : "";
  return renderPromptTemplate(getAgentInitialUserPromptTemplate(), {
    todo: task.trim(),
    context_section: contextSection,
  });
}

function buildApprovalTitle(toolName: string, provider: string): string {
  const clean = toolName.includes("__") ? toolName.split("__").slice(1).join("__") : toolName;
  const label = provider === "notion" ? "Notion" : provider === "linear" ? "Linear" : "MCP";
  return `${label} tool: ${clean}`;
}

function summarizeApprovalInput(input: unknown): string {
  try {
    const text = JSON.stringify(input);
    if (!text) return "(no input)";
    return text.length > 600 ? `${text.slice(0, 600)}...` : text;
  } catch {
    return String(input ?? "(no input)");
  }
}


async function buildTools(
  exa: ExaClient,
  getTranscriptContext: () => string,
  requestClarification: AgentDeps["requestClarification"],
  requestToolApproval: AgentDeps["requestToolApproval"],
  onStep: AgentDeps["onStep"],
  allowAutoApprove: boolean,
  getExternalTools?: AgentDeps["getExternalTools"],
) {
  const baseTools: Record<string, unknown> = {
    searchWeb: tool({
      description:
        "Search the web for information when external facts are required. Use specific, targeted queries.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
      }),
      execute: async ({ query }) => {
        const results = await exa.search(query, {
          type: "auto",
          numResults: 10,
          text: { maxCharacters: 1500 },
        });

        // const formatted = results.results
        //   .map((r) => `**${r.title}** (${r.url})\n${r.text ?? ""}`)
        //   .join("\n\n---\n\n");

        // return formatted;
        return results.results;
      },
    }),
    getTranscriptContext: tool({
      description:
        "Get recent transcript blocks from the current conversation for more context.",
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
        const answers = await requestClarification(input, {
          toolCallId,
          abortSignal,
        });
        return {
          title: input.title,
          questions: input.questions,
          answers,
        };
      },
    }),
  };

  if (!getExternalTools) {
    return baseTools;
  }

  let externalTools: AgentExternalToolSet = {};
  try {
    externalTools = await getExternalTools();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", `Failed to load external MCP tools: ${message}`);
    onStep({
      id: `mcp-tools:error:${Date.now()}`,
      kind: "tool-result",
      content: `MCP tools unavailable: ${message}`,
      toolName: "mcp",
      createdAt: Date.now(),
    });
    return baseTools;
  }

  // Instead of registering every MCP tool directly, expose two meta-tools so
  // the full tool registry never lands in the model's context window.
  baseTools["searchMcpTools"] = tool({
    description:
      "Search available MCP integration tools (Notion, Linear, and custom servers). Call this first to discover tools before using callMcpTool.",
    inputSchema: z.object({
      query: z.string().describe("Keywords to search for, e.g. 'create page', 'list issues', 'search'"),
    }),
    execute: async ({ query }) => {
      const q = query.toLowerCase();
      const matches = Object.entries(externalTools)
        .filter(([name, t]) =>
          name.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q)
        )
        .slice(0, 10)
        .map(([name, t]) => ({
          name,
          description: t.description ?? `MCP tool: ${name}`,
          isMutating: t.isMutating,
          inputSchema: t.inputSchema,
        }));
      return matches.length > 0
        ? matches
        : { message: "No tools matched. Try broader keywords." };
    },
  });

  const callMcpToolSchema = allowAutoApprove
    ? z.object({
        name: z.string().describe("Tool name from searchMcpTools results"),
        args: z.record(z.string(), z.unknown()).describe("Arguments matching the tool's inputSchema"),
        _autoApprove: z.boolean().optional().describe(
          "Set to true only when creating brand-new content that does not overwrite or delete anything existing, and the action can be easily undone. Leave false or omit for updates, deletes, archives, or any irreversible change."
        ),
      })
    : z.object({
        name: z.string().describe("Tool name from searchMcpTools results"),
        args: z.record(z.string(), z.unknown()).describe("Arguments matching the tool's inputSchema"),
      });

  baseTools["callMcpTool"] = tool({
    description:
      "Execute an MCP integration tool by name. Use searchMcpTools first to find the right tool and its required arguments.",
    inputSchema: callMcpToolSchema,
    execute: async (input, { toolCallId, abortSignal }) => {
      const { name, args, _autoApprove: autoApprove } = input as {
        name: string;
        args: Record<string, unknown>;
        _autoApprove?: boolean;
      };

      const external = externalTools[name];
      if (!external) {
        return { error: `Tool "${name}" not found. Use searchMcpTools to find available tools.` };
      }

      const approvalId = `approval:${toolCallId}`;

      if (external.isMutating && !autoApprove) {
        const request: AgentToolApprovalRequest = {
          id: approvalId,
          toolName: name,
          provider: external.provider,
          title: buildApprovalTitle(name, external.provider),
          summary: "This tool can create, update, or delete external data.",
          input: summarizeApprovalInput(args),
        };

        onStep({
          id: `${approvalId}:requested`,
          kind: "tool-call",
          toolName: name,
          toolInput: request.input,
          approvalId,
          approvalState: "approval-requested",
          content: `Approval required: ${request.title}`,
          createdAt: Date.now(),
        });

        const approvalResponse = await requestToolApproval(request, {
          toolCallId,
          abortSignal,
        });

        onStep({
          id: `${approvalId}:responded`,
          kind: "tool-result",
          toolName: name,
          toolInput: request.input,
          approvalId,
          approvalState: "approval-responded",
          approvalApproved: approvalResponse.approved,
          content: approvalResponse.approved ? "Approved by user" : "Rejected by user",
          createdAt: Date.now(),
        });

        if (!approvalResponse.approved) {
          onStep({
            id: `${approvalId}:denied`,
            kind: "tool-result",
            toolName: name,
            toolInput: request.input,
            approvalId,
            approvalState: "output-denied",
            approvalApproved: false,
            content: "Tool execution denied",
            createdAt: Date.now(),
          });
          return { denied: true, reason: "User denied this tool execution." };
        }
      }

      const output = await external.execute(args, { toolCallId, abortSignal });

      if (external.isMutating && !autoApprove) {
        onStep({
          id: `${approvalId}:completed`,
          kind: "tool-result",
          toolName: name,
          toolInput: summarizeApprovalInput(output),
          approvalId,
          approvalState: "output-available",
          approvalApproved: true,
          content: "Tool execution completed",
          createdAt: Date.now(),
        });
      }

      return output;
    },
  });

  return baseTools;
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

function summarizeToolCall(
  toolName: string,
  input: unknown
): {
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

  if (toolName === "searchMcpTools") {
    const query = getSearchQuery(input);
    return { content: query ? `Searching MCP tools: ${query}` : "Searching MCP tools" };
  }

  if (toolName === "callMcpTool") {
    const name = (input as Record<string, unknown>)?.name;
    return { content: typeof name === "string" ? `Calling MCP tool: ${name}` : "Calling MCP tool", toolInput: safeJson(input) };
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

  if (toolName === "searchMcpTools") {
    const results = Array.isArray(output) ? output : [];
    return { content: `Found ${results.length} MCP tool${results.length === 1 ? "" : "s"}` };
  }

  if (toolName === "callMcpTool") {
    const name = (input as Record<string, unknown>)?.name;
    return { content: typeof name === "string" ? `${name} complete` : "MCP tool complete", toolInput: safeJson(output) };
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
  const initialPrompt = buildAgentInitialUserPrompt(
    agent.task,
    agent.taskContext
  );
  const inputMessages: ModelMessage[] = [
    { role: "user", content: initialPrompt },
  ];
  await runAgentWithMessages(agent, inputMessages, deps);
}

/**
 * Continue an agent conversation with existing messages + a new user question.
 */
export async function continueAgent(
  agent: Agent,
  previousMessages: ModelMessage[],
  followUpQuestion: string,
  deps: AgentDeps
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
  deps: AgentDeps
): Promise<void> {
  const {
    model,
    exa,
    getTranscriptContext,
    projectInstructions,
    getExternalTools,
    allowAutoApprove,
    requestClarification,
    requestToolApproval,
    onStep,
    onComplete,
    onFail,
    abortSignal,
  } = deps;

  let streamError: string | null = null;

  try {
    const systemPrompt = buildSystemPrompt(getTranscriptContext(), projectInstructions);
    const tools = await buildTools(
      exa,
      getTranscriptContext,
      requestClarification,
      requestToolApproval,
      onStep,
      allowAutoApprove,
      getExternalTools,
    );

    const result = streamText({
      model,
      system: systemPrompt,
      messages: inputMessages,
      stopWhen: stepCountIs(8),
      abortSignal,
      tools: tools as Parameters<typeof streamText>[0]["tools"],
      onError: ({ error }) => {
        streamError = error instanceof Error ? error.message : String(error);
      },
      onAbort: () => {
        onFail("Cancelled");
      },
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
          const { content, toolInput } = summarizeToolCall(
            part.toolName,
            part.input
          );
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
        case "tool-output-denied": {
          const toolStepId = `tool:${part.toolCallId}`;
          onStep({
            id: toolStepId,
            kind: "tool-result",
            content: `${part.toolName} denied`,
            toolName: part.toolName,
            toolInput: safeJson(part),
            approvalState: "output-denied",
            approvalApproved: false,
            createdAt: Date.now(),
          });
          break;
        }
        case "abort": {
          return;
        }
        default: {
          break;
        }
      }
    }

    const finalText =
      (await result.text).trim() || streamedText || "No results found.";
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
    // streamError has the real provider error (e.g. rate limit). NoOutputGeneratedError
    // is the SDK wrapper thrown when the stream ends with no steps recorded.
    const message = streamError ?? (error instanceof Error ? error.message : String(error));
    onFail(message);
  }
}
