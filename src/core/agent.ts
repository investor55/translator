import { generateText, tool, stepCountIs } from "ai";
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
  onComplete: (result: string) => void;
  onFail: (error: string) => void;
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

export async function runAgent(agent: Agent, deps: AgentDeps): Promise<void> {
  const { model, exa, getTranscriptContext, onStep, onComplete, onFail } = deps;

  const systemPrompt = `You are a helpful research agent. Your task is to research the following and provide a concise, actionable answer.

Conversation context from the current session:
${getTranscriptContext()}

Instructions:
- Use the searchWeb tool to find relevant information
- Use the getTranscriptContext tool if you need more conversation context
- Be concise — aim for 2-4 sentences in your final answer
- Cite sources with URLs when possible
- Focus on actionable, specific results (e.g., specific restaurant names, addresses, hours)`;

  try {
    const { text, steps } = await generateText({
      model,
      system: systemPrompt,
      prompt: agent.task,
      stopWhen: stepCountIs(5),
      tools: {
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
      },
      onStepFinish: async ({ text: stepText }) => {
        if (stepText) {
          onStep(makeStep("thinking", stepText));
        }
      },
    });

    // Emit final text steps from the generation
    for (const step of steps) {
      if (step.text && step.text !== text) {
        onStep(makeStep("thinking", step.text));
      }
    }

    const finalText = text || "No results found.";
    onStep(makeStep("text", finalText));
    onComplete(finalText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onFail(message);
  }
}
