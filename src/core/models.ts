// Centralized model configuration. Add/remove models here.
// Set reasoning: true for models that support extended thinking.
// The label should indicate this (e.g. "Model Name (Thinking)").

export type AnalysisModelPreset = {
  label: string;
  modelId: string;
  reasoning: boolean;
  providerOnly?: string;
};

export type TodoModelPreset = {
  label: string;
  modelId: string;
  providers: string[];
};

export type UtilityModelPreset = {
  label: string;
  modelId: string;
};

// Agent reasoning models (heavy)
export const ANALYSIS_MODEL_PRESETS: AnalysisModelPreset[] = [
  {
    label: "Claude Sonnet 4.6",
    modelId: "anthropic/claude-sonnet-4.6",
    reasoning: false,
  },
  {
    label: "Kimi K2 0905 Exacto",
    modelId: "moonshotai/kimi-k2-0905:exacto",
    reasoning: false,
  },
  {
    label: "Kimi K2.5 Thinking",
    modelId: "moonshotai/kimi-k2.5",
    reasoning: true,
  },
  {
    label: "GLM 4.7 Thinking",
    modelId: "z-ai/glm-4.7",
    reasoning: true,
  },
  {
    label: "GLM 5 Thinking",
    modelId: "z-ai/glm-5",
    reasoning: true,
  },
];

// Todo extraction models
export const TODO_MODEL_PRESETS: TodoModelPreset[] = [
  {
    label: "GPT-OSS 120B",
    modelId: "openai/gpt-oss-120b",
    providers: ["sambanova", "groq", "cerebras"],
  },
];

// Utility models (titles, summaries, post-processing) and memory (learning extraction)
// These should support structured output (generateObject).
export const UTILITY_MODEL_PRESETS: UtilityModelPreset[] = [
  { label: "GPT-OSS 20B", modelId: "openai/gpt-oss-20b" },
  { label: "GPT-OSS 120B", modelId: "openai/gpt-oss-120b" },
  { label: "Claude Sonnet 4.6", modelId: "anthropic/claude-sonnet-4.6" },
  { label: "GLM 4.7", modelId: "z-ai/glm-4.7" },
];

export const DEFAULT_UTILITY_MODEL_ID = "openai/gpt-oss-20b";
export const DEFAULT_MEMORY_MODEL_ID = "openai/gpt-oss-20b";

export function getAnalysisModelPreset(
  modelId: string,
): AnalysisModelPreset | undefined {
  return ANALYSIS_MODEL_PRESETS.find((preset) => preset.modelId === modelId);
}
