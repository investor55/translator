import { generateText, streamText, tool, stepCountIs, type ModelMessage } from "ai";
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
import { normalizeProviderErrorMessage } from "../text/text-utils";
import type { AgentExternalToolSet } from "./external-tools";
import {
  rankExternalTools,
  resolveExternalToolName,
  shouldRequireApproval,
} from "./mcp-tool-resolution";

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
  agentsMd?: string;
  compact?: boolean;
  searchTranscriptHistory?: (query: string, limit?: number) => unknown[];
  searchAgentHistory?: (query: string, limit?: number) => unknown[];
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
  onFail: (error: string, messages?: ModelMessage[]) => void;
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

const buildSystemPrompt = (
  transcriptContext: string,
  projectInstructions?: string,
  agentsMd?: string,
  compact?: boolean,
) => {
  const base = renderPromptTemplate(getAgentSystemPromptTemplate(), {
    today: formatCurrentDateForPrompt(new Date()),
    transcript_context: transcriptContext,
  });

  const sections: string[] = [];
  if (projectInstructions?.trim()) {
    sections.push(`## Project Instructions\n\n${projectInstructions.trim()}`);
  }
  if (agentsMd?.trim()) {
    sections.push(`## Agent Memory\n\n${agentsMd.trim()}`);
  }
  sections.push(base);

  if (compact) {
    sections.push(
      "## Response Length\n\n" +
      "Be concise. Prefer short paragraphs and bullet points over long prose. " +
      "Lead with the key finding or answer, then add supporting detail only if it adds clear value. " +
      "Omit filler, preambles, and restating the question. " +
      "Aim for the shortest response that fully addresses the task."
    );
  }

  return sections.join("\n\n---\n\n");
};

export function buildAgentInitialUserPrompt(
  task: string,
  taskContext?: string
): string {
  const contextText = taskContext?.trim();
  const contextSection = contextText ? `\n\nContext:\n${contextText}` : "";
  return renderPromptTemplate(getAgentInitialUserPromptTemplate(), {
    task: task.trim(),
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

function getLatestUserMessageText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const { content } = message;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
            const text = (part as { text?: unknown }).text;
            return typeof text === "string" ? text : "";
          }
          return "";
        })
        .join(" ")
        .trim();
    }
  }
  return "";
}

function shouldForceMcpToolLoop(userText: string): boolean {
  if (!userText.trim()) return false;
  const hasIntegrationNoun =
    /\b(notion|linear|workspace|database|page|issue|project|task|ticket|mcp)\b/i.test(
      userText,
    );
  const hasActionVerb =
    /\b(create|add|update|edit|delete|archive|find|search|list|look\s*up|open|append|move|set)\b/i.test(
      userText,
    );
  return hasIntegrationNoun && hasActionVerb;
}

function isContinuationPrompt(userText: string): boolean {
  const normalized = userText.toLowerCase().trim();
  if (!normalized) return false;
  return /^(continue|go on|proceed|keep going|again|try again|yes|yep|ok|okay)\.?$/.test(
    normalized,
  );
}

function hasRecentMcpContextInMessages(messages: ModelMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0 && i >= messages.length - 8; i--) {
    const message = messages[i];
    if (!message) continue;

    if (typeof message.content === "string") {
      if (/searchMcpTools|callMcpTool|notion__|linear__/i.test(message.content)) {
        return true;
      }
      continue;
    }

    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!part || typeof part !== "object") continue;
      const maybeToolName = (part as { toolName?: unknown }).toolName;
      if (
        maybeToolName === "searchMcpTools" ||
        maybeToolName === "callMcpTool"
      ) {
        return true;
      }

      const maybeType = (part as { type?: unknown }).type;
      if (maybeType === "tool-call" || maybeType === "tool-result") {
        const toolName = (part as { toolName?: unknown }).toolName;
        if (
          toolName === "searchMcpTools" ||
          toolName === "callMcpTool"
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function shouldEnforceMcpLoop(userText: string, messages: ModelMessage[]): boolean {
  if (shouldForceMcpToolLoop(userText)) return true;
  if (isContinuationPrompt(userText) && hasRecentMcpContextInMessages(messages)) {
    return true;
  }
  return false;
}

function hasMcpMetaTools(tools: Record<string, unknown>): boolean {
  return !!tools.searchMcpTools && !!tools.callMcpTool;
}

type CallMcpToolErrorCode =
  | "tool_name_required"
  | "tool_ambiguous"
  | "tool_not_found"
  | "no_tools_available"
  | "missing_or_invalid_args"
  | "tool_execution_failed"
  | "tool_denied";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function classifyToolExecutionError(message: string): CallMcpToolErrorCode {
  if (/missing|required|invalid|argument|parameter|schema|input/i.test(message)) {
    return "missing_or_invalid_args";
  }
  return "tool_execution_failed";
}

function getMcpCallResultCode(output: unknown): CallMcpToolErrorCode | null {
  const record = asObject(output);
  if (!record) return null;
  const code = record.errorCode;
  return typeof code === "string" ? (code as CallMcpToolErrorCode) : null;
}

function getMcpCallResultStatus(output: unknown): "success" | "error" | "denied" {
  if (typeof output === "string") {
    const normalized = output.trim().toLowerCase();
    if (!normalized) return "success";
    if (/\b(denied|rejected|forbidden|not approved)\b/.test(normalized)) {
      return "denied";
    }
    if (/\b(error|failed|failure|exception|invalid|missing)\b/.test(normalized)) {
      return "error";
    }
    return "success";
  }

  const code = getMcpCallResultCode(output);
  if (code === "tool_denied") return "denied";
  if (code) return "error";

  const record = asObject(output);
  if (!record) return "success";
  const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
  if (status === "denied" || status === "rejected") return "denied";
  if (status === "error" || status === "failed" || status === "failure") return "error";
  if (record.ok === false || record.success === false) return "error";
  if (record.isError === true) return "error";
  if (record.denied === true) return "denied";
  if (typeof record.error === "string" && record.error.trim().length > 0) {
    return "error";
  }
  return "success";
}

function getMcpCallResultHint(output: unknown): string {
  const record = asObject(output);
  if (!record) return "";
  const hint = record.hint;
  const error = record.error;
  const content = record.content;
  const hintText = typeof hint === "string" ? hint : "";
  const errorText = typeof error === "string" ? error : "";
  const contentText = Array.isArray(content)
    ? content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const typed = item as { type?: unknown; text?: unknown };
        if (typed.type !== "text" || typeof typed.text !== "string") return "";
        return typed.text;
      })
      .filter(Boolean)
      .join(" ")
    : "";
  return `${errorText} ${hintText} ${contentText}`.trim().toLowerCase();
}

function getMcpCallResultErrorText(output: unknown): string {
  const record = asObject(output);
  if (!record) return "";
  const error = record.error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "";
}

function looksLikeIntentOnlyText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || normalized === "No results found.") {
    return true;
  }

  const lower = normalized.toLowerCase();
  const hasIntentLead = /\b(let me|i'll|i will|i need to|i can|i'm going to)\b/.test(lower);
  const hasFutureAction =
    /\b(search|check|look up|look for|find|get|fetch|retrieve|call|try)\b/.test(lower);
  const hasConcreteResultSignal =
    /\b(found|here(?:'s| is| are)|results?|according to|based on|it shows|i checked)\b/.test(lower);

  return hasIntentLead && hasFutureAction && !hasConcreteResultSignal;
}

function hasSuccessfulMcpToolResultFromSteps(
  steps: Array<{
    toolResults: Array<{ toolName: string; output: unknown }>;
  }>,
): boolean {
  return steps.some((step) =>
    step.toolResults.some(
      (result) =>
        result.toolName === "callMcpTool" &&
        getMcpCallResultStatus(result.output) === "success",
    ),
  );
}


async function buildTools(
  exa: ExaClient,
  getTranscriptContext: () => string,
  requestClarification: AgentDeps["requestClarification"],
  requestToolApproval: AgentDeps["requestToolApproval"],
  onStep: AgentDeps["onStep"],
  allowAutoApprove: boolean,
  getExternalTools?: AgentDeps["getExternalTools"],
  searchTranscriptHistory?: AgentDeps["searchTranscriptHistory"],
  searchAgentHistory?: AgentDeps["searchAgentHistory"],
) {
  const baseTools: Record<string, unknown> = {
    searchWeb: tool({
      description:
        "Search the web for information when external facts are required. Use specific, targeted queries.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
      }),
      execute: async ({ query }) => {
        try {
          const results = await exa.search(query, {
            type: "auto",
            numResults: 10,
            text: { maxCharacters: 1500 },
          });

          return results.results;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log("WARN", `searchWeb failed: ${message}`);
          return {
            error: message,
            hint:
              "Web search is temporarily unavailable. Continue with available context, or ask the user if they want to proceed without web search.",
          };
        }
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
        const enrichedAnswers = answers.map((answer) => {
          const question = input.questions.find((q) => q.id === answer.questionId);
          const selectedLabels = question
            ? answer.selectedOptionIds
                .map((optId) => question.options.find((opt) => opt.id === optId)?.label)
                .filter(Boolean)
            : [];
          return {
            ...answer,
            selectedLabels,
            ...(answer.freeText ? { userText: answer.freeText } : {}),
          };
        });
        return {
          title: input.title,
          questions: input.questions,
          answers: enrichedAnswers,
        };
      },
    }),
  };

  if (searchTranscriptHistory) {
    baseTools["searchTranscriptHistory"] = tool({
      description:
        "Search past transcript blocks by keyword. Use to find specific topics, phrases, or discussions from previous sessions.",
      inputSchema: z.object({
        query: z.string().describe("FTS5 keyword query (e.g. 'budget meeting' or 'API integration')"),
        limit: z.number().optional().describe("Max results to return (default 20)"),
      }),
      execute: async ({ query, limit }) => searchTranscriptHistory(query, limit),
    });
  }

  if (searchAgentHistory) {
    baseTools["searchAgentHistory"] = tool({
      description:
        "Search past agent tasks and results by keyword. Use to find what previous agents discovered or decided.",
      inputSchema: z.object({
        query: z.string().describe("FTS5 keyword query (e.g. 'pricing strategy' or 'competitor analysis')"),
        limit: z.number().optional().describe("Max results to return (default 20)"),
      }),
      execute: async ({ query, limit }) => searchAgentHistory(query, limit),
    });
  }

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
      if (Object.keys(externalTools).length === 0) {
        throw new Error("No MCP tools are currently available. Connect an integration first.");
      }
      const matches = rankExternalTools(query, externalTools, 10).map(({ name, tool: t }) => ({
          name,
          description: t.description ?? `MCP tool: ${name}`,
          isMutating: t.isMutating,
          inputSchema: t.inputSchema,
      }));
      return matches;
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

      const resolution = resolveExternalToolName(name, externalTools);
      if (resolution.ok === false) {
        return resolution.suggestions
          ? {
            errorCode: resolution.code,
            error: resolution.error,
            hint: resolution.hint,
            suggestions: resolution.suggestions,
          }
          : {
            errorCode: resolution.code,
            error: resolution.error,
            hint: resolution.hint,
          };
      }

      const resolvedName = resolution.toolName;
      const external = externalTools[resolvedName];
      if (!external) {
        return {
          errorCode: "tool_not_found" as const,
          error: `Tool "${resolvedName}" not found.`,
          hint: "Call searchMcpTools with relevant keywords and use the exact tool name returned.",
        };
      }

      const approvalId = `approval:${toolCallId}`;
      const requiresApproval = shouldRequireApproval(
        external.isMutating,
        allowAutoApprove,
        autoApprove,
      );

      if (requiresApproval) {
        const request: AgentToolApprovalRequest = {
          id: approvalId,
          toolName: resolvedName,
          provider: external.provider,
          title: buildApprovalTitle(resolvedName, external.provider),
          summary: "This tool can create, update, or delete external data.",
          input: summarizeApprovalInput(args),
        };

        onStep({
          id: `${approvalId}:requested`,
          kind: "tool-call",
          toolName: resolvedName,
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
          toolName: resolvedName,
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
            toolName: resolvedName,
            toolInput: request.input,
            approvalId,
            approvalState: "output-denied",
            approvalApproved: false,
            content: "Tool execution denied",
            createdAt: Date.now(),
          });
          return {
            denied: true,
            reason: "User denied this tool execution.",
            errorCode: "tool_denied" as const,
          };
        }
      }

      let output: unknown;
      try {
        output = await external.execute(args, { toolCallId, abortSignal });
      } catch (execError) {
        const message = execError instanceof Error ? execError.message : String(execError);
        return {
          errorCode: classifyToolExecutionError(message),
          error: `Tool "${resolvedName}" failed: ${message}`,
          hint: "Check the tool's inputSchema and fix the arguments, or call askQuestion to ask the user for the required information.",
        };
      }

      if (requiresApproval) {
        onStep({
          id: `${approvalId}:completed`,
          kind: "tool-result",
          toolName: resolvedName,
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

  if (toolName === "searchTranscriptHistory") {
    const query = getSearchQuery(input);
    return { content: query ? `Searching transcripts: ${query}` : "Searching transcript history" };
  }

  if (toolName === "searchAgentHistory") {
    const query = getSearchQuery(input);
    return { content: query ? `Searching agents: ${query}` : "Searching agent history" };
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

  if (toolName === "searchTranscriptHistory") {
    const results = Array.isArray(output) ? output : [];
    return { content: `Found ${results.length} transcript${results.length === 1 ? "" : "s"}` };
  }

  if (toolName === "searchAgentHistory") {
    const results = Array.isArray(output) ? output : [];
    return { content: `Found ${results.length} agent result${results.length === 1 ? "" : "s"}` };
  }

  if (toolName === "searchMcpTools") {
    const results = Array.isArray(output) ? output : [];
    return { content: `Found ${results.length} MCP tool${results.length === 1 ? "" : "s"}` };
  }

  if (toolName === "callMcpTool") {
    const name = (input as Record<string, unknown>)?.name;
    const label = typeof name === "string" ? name : "MCP tool";
    const status = getMcpCallResultStatus(output);
    if (status === "error") {
      const errorText = getMcpCallResultErrorText(output);
      return {
        content: `${label} failed`,
        toolInput: errorText || safeJson(output),
      };
    }
    if (status === "denied") {
      return { content: `${label} denied`, toolInput: safeJson(output) };
    }
    return { content: `${label} complete`, toolInput: safeJson(output) };
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
    agentsMd,
    compact,
    searchTranscriptHistory,
    searchAgentHistory,
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
    const systemPrompt = buildSystemPrompt(
      getTranscriptContext(),
      projectInstructions,
      agentsMd,
      compact,
    );
    const tools = await buildTools(
      exa,
      getTranscriptContext,
      requestClarification,
      requestToolApproval,
      onStep,
      allowAutoApprove,
      getExternalTools,
      searchTranscriptHistory,
      searchAgentHistory,
    );
    const latestUserText = getLatestUserMessageText(inputMessages);
    const enforceMcpLoop =
      hasMcpMetaTools(tools) && shouldEnforceMcpLoop(latestUserText, inputMessages);

    const result = streamText({
      model,
      system: systemPrompt,
      messages: inputMessages,
      stopWhen: stepCountIs(20),
      prepareStep: enforceMcpLoop
        ? ({ stepNumber, steps }) => {
          const hasSearchMcpToolCall = steps.some((step) =>
            step.toolCalls.some((call) => call.toolName === "searchMcpTools"),
          );
          const callMcpToolResults = steps.flatMap((step) =>
            step.toolResults.filter((toolResult) => toolResult.toolName === "callMcpTool"),
          );
          const hasAskQuestionToolCall = steps.some((step) =>
            step.toolCalls.some((call) => call.toolName === "askQuestion"),
          );
          const hasAskQuestionToolResult = steps.some((step) =>
            step.toolResults.some((toolResult) => toolResult.toolName === "askQuestion"),
          );
          const callMcpToolStatuses = callMcpToolResults.map((toolResult) =>
            getMcpCallResultStatus(toolResult.output),
          );
          const hasSuccessfulCallMcpToolResult = callMcpToolResults.some(
            (toolResult) => getMcpCallResultStatus(toolResult.output) === "success",
          );
          const callMcpToolAttemptCount = callMcpToolResults.length;
          const callMcpToolErrorCount = callMcpToolStatuses.filter(
            (status) => status === "error",
          ).length;
          const consecutiveCallMcpFailures = (() => {
            let count = 0;
            for (let i = callMcpToolStatuses.length - 1; i >= 0; i--) {
              if (callMcpToolStatuses[i] === "success") break;
              count += 1;
            }
            return count;
          })();
          const latestCallMcpToolResult = callMcpToolResults[callMcpToolResults.length - 1];
          const latestCallStatus = latestCallMcpToolResult
            ? getMcpCallResultStatus(latestCallMcpToolResult.output)
            : null;
          const latestCallCode = latestCallMcpToolResult
            ? getMcpCallResultCode(latestCallMcpToolResult.output)
            : null;
          const latestCallHint = latestCallMcpToolResult
            ? getMcpCallResultHint(latestCallMcpToolResult.output)
            : "";

          if (stepNumber === 0 || !hasSearchMcpToolCall) {
            return {
              activeTools: ["searchMcpTools"],
              toolChoice: { type: "tool", toolName: "searchMcpTools" as const },
            };
          }

          if (hasSuccessfulCallMcpToolResult) {
            return { toolChoice: "none" as const };
          }

          // Prefer clarification over long speculative tool loops.
          if (callMcpToolAttemptCount >= 3 && !hasSuccessfulCallMcpToolResult) {
            if (hasAskQuestionToolCall || hasAskQuestionToolResult) {
              return { toolChoice: "none" as const };
            }
            return {
              activeTools: ["askQuestion"],
              toolChoice: { type: "tool", toolName: "askQuestion" as const },
            };
          }

          // Stop retry spirals: after repeated failed MCP executions, force one
          // clarification question; if that already happened, stop tool-calling.
          if (
            (consecutiveCallMcpFailures >= 3 || callMcpToolErrorCount >= 4) &&
            !hasSuccessfulCallMcpToolResult
          ) {
            if (hasAskQuestionToolCall || hasAskQuestionToolResult) {
              return { toolChoice: "none" as const };
            }
            return {
              activeTools: ["askQuestion"],
              toolChoice: { type: "tool", toolName: "askQuestion" as const },
            };
          }

          if (latestCallStatus === "error") {
            if (
              latestCallCode === "tool_not_found" ||
              latestCallCode === "tool_ambiguous" ||
              latestCallCode === "tool_name_required"
            ) {
              return {
                activeTools: ["searchMcpTools"],
                toolChoice: { type: "tool", toolName: "searchMcpTools" as const },
              };
            }

            if (latestCallCode === "missing_or_invalid_args") {
              return {
                activeTools: ["askQuestion"],
                toolChoice: { type: "tool", toolName: "askQuestion" as const },
              };
            }

            if (latestCallCode === "no_tools_available") {
              return { toolChoice: "none" as const };
            }

            if (
              /not found|ambiguous|exact tool name|searchmcptools/.test(
                latestCallHint,
              )
            ) {
              return {
                activeTools: ["searchMcpTools"],
                toolChoice: { type: "tool", toolName: "searchMcpTools" as const },
              };
            }

            if (
              /invalid|missing|required|argument|parameter|inputschema/.test(
                latestCallHint,
              )
            ) {
              return {
                activeTools: ["askQuestion"],
                toolChoice: { type: "tool", toolName: "askQuestion" as const },
              };
            }
          }

          if (latestCallStatus === "denied") {
            return { toolChoice: "none" as const };
          }

          // After clarification has been answered, let the model decide
          // freely — don't force more tool calls or it creates a loop.
          if (hasAskQuestionToolResult) {
            return {};
          }

          if (stepNumber >= 1) {
            return {
              activeTools: ["callMcpTool", "askQuestion"],
              toolChoice: "required" as const,
            };
          }
          return {};
        }
        : undefined,
      abortSignal,
      tools: tools as Parameters<typeof streamText>[0]["tools"],
      onError: ({ error }) => {
        streamError = error instanceof Error ? error.message : String(error);
      },
      onAbort: () => {
        onFail("Cancelled", inputMessages);
      },
    });

    const streamedAt = Date.now();
    let textStepId: string | null = null;
    let streamedText = "";
    let lastNonEmptyText = ""; // survives start-step resets; used as finalText fallback
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
          const errorMessage = part.error instanceof Error ? part.error.message : safeJson(part.error);
          // For askQuestion, preserve the original tool-call step so the question
          // card stays visible even if the tool execution errors (e.g. agent
          // cancelled/failed while waiting for user input).
          const stepId = part.toolName === "askQuestion"
            ? `${toolStepId}:error`
            : toolStepId;
          onStep({
            id: stepId,
            kind: "tool-result",
            content: `${part.toolName} failed: ${errorMessage}`,
            toolName: part.toolName,
            toolInput: errorMessage,
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
        case "start-step": {
          // Preserve last step's text before resetting for the new step
          if (streamedText) lastNonEmptyText = streamedText;
          streamedText = "";
          textStepId = null;
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

    // result.text resolves to the last step's text only (SDK design).
    // Fall back to lastNonEmptyText so tool-only final steps don't clobber earlier output.
    if (streamedText) lastNonEmptyText = streamedText;
    const lastStepText = (await result.text).trim();
    let finalText = lastStepText || lastNonEmptyText || "No results found.";

    // Only emit the final text step if result.text has content — it finalises the
    // last streamed text block. If the final step was tool-only, streaming already
    // emitted the correct content and we don't need to overwrite anything.
    if (lastStepText && textStepId) {
      onStep({
        id: textStepId,
        kind: "text",
        content: lastStepText,
        createdAt: streamedAt,
      });
    }

    // Build full conversation history for future follow-ups
    const response = await result.response;
    let fullHistory = [...inputMessages, ...response.messages];
    const steps = await result.steps;
    const shouldForceFinalization =
      hasSuccessfulMcpToolResultFromSteps(steps as Array<{ toolResults: Array<{ toolName: string; output: unknown }> }>) &&
      looksLikeIntentOnlyText(finalText) &&
      !abortSignal?.aborted;

    if (shouldForceFinalization) {
      const finalize = await generateText({
        model,
        system: `${systemPrompt}\n\nYou already have tool results. Respond with a concrete completed update now. Do not describe future actions.`,
        messages: fullHistory,
      });
      const finalizedText = finalize.text.trim();
      if (finalizedText) {
        finalText = finalizedText;
        const finalizeStepId = `text:finalize:${Date.now()}`;
        onStep({
          id: finalizeStepId,
          kind: "text",
          content: finalizedText,
          createdAt: Date.now(),
        });
        fullHistory = [...fullHistory, ...finalize.response.messages];
      }
    }

    log(
      "INFO",
      `Agent stream ${agent.id}: deltas=${deltaCount}, firstDeltaMs=${firstDeltaAfterMs ?? -1}, totalMs=${Date.now() - streamedAt}`
    );
    onComplete(finalText, fullHistory);
  } catch (error) {
    // streamError has the real provider error (e.g. rate limit). NoOutputGeneratedError
    // is the SDK wrapper thrown when the stream ends with no steps recorded.
    const rawMessage = streamError ?? (error instanceof Error ? error.message : String(error));
    const message = normalizeProviderErrorMessage(rawMessage);
    onFail(message, inputMessages);
  }
}
