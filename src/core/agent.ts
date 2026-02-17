import { generateText, tool, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import type { AgentStep, Agent } from "./types";

type ExaClient = {
  searchAndContents: (query: string, options: Record<string, unknown>) => Promise<{
    results: Array<{ title: string; url: string; text?: string }>;
  }>;
};

type AgentDeps = {
  model: Parameters<typeof generateText>[0]["model"];
  exa: ExaClient;
  getTranscriptContext: () => string;
  onStep: (step: AgentStep) => void;
  onComplete: (result: string, messages: ModelMessage[]) => void;
  onFail: (error: string) => void;
  abortSignal?: AbortSignal;
};

function makeStep(kind: AgentStep["kind"], content: string, toolName?: string, toolInput?: string): AgentStep {
  return {
    id: crypto.randomUUID(),
    kind,
    content,
    toolName,
    toolInput,
    createdAt: Date.now(),
  };
}

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

function buildTools(exa: ExaClient, getTranscriptContext: () => string, onStep: AgentDeps["onStep"]) {
  return {
    searchWeb: tool({
      description: "Search the web for information. Use specific, targeted queries.",
      inputSchema: z.object({
        query: z.string().describe("The search query"),
      }),
      execute: async ({ query }) => {
        onStep(makeStep("tool-call", query, "searchWeb", JSON.stringify({ query })));

        const results = await exa.searchAndContents(query, {
          type: "auto",
          numResults: 5,
          text: { maxCharacters: 1500 },
        });

        const formatted = results.results
          .map((r) => `**${r.title}** (${r.url})\n${r.text ?? ""}`)
          .join("\n\n---\n\n");

        onStep(makeStep("tool-result", formatted, "searchWeb"));
        return formatted;
      },
    }),
    getTranscriptContext: tool({
      description: "Get recent transcript blocks from the current conversation for more context.",
      inputSchema: z.object({}),
      execute: async () => {
        const context = getTranscriptContext();
        onStep(makeStep("tool-result", context, "getTranscriptContext"));
        return context;
      },
    }),
  };
}

/**
 * Run agent with an initial prompt (first turn).
 */
export async function runAgent(agent: Agent, deps: AgentDeps): Promise<void> {
  const inputMessages: ModelMessage[] = [{ role: "user", content: agent.task }];
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
  const tools = buildTools(exa, getTranscriptContext, onStep);

  try {
    const { text, steps, response } = await generateText({
      model,
      system: systemPrompt,
      messages: inputMessages,
      stopWhen: stepCountIs(5),
      abortSignal,
      tools,
      onStepFinish: async ({ text: stepText }) => {
        if (stepText) {
          onStep(makeStep("thinking", stepText));
        }
      },
    });

    for (const step of steps) {
      if (step.text && step.text !== text) {
        onStep(makeStep("thinking", step.text));
      }
    }

    const finalText = text || "No results found.";
    onStep(makeStep("text", finalText));

    // Build full conversation history for future follow-ups
    const fullHistory = [...inputMessages, ...response.messages];
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
