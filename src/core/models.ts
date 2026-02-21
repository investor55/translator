// Centralized model configuration. Add/remove models here.
// Set reasoning: true for models that support extended thinking.
// The label should indicate this (e.g. "Model Name (Thinking)").

export type AnalysisModelPreset = {
  label: string;
  modelId: string;
  reasoning: boolean;
  providerOnly?: string;
};

export type TaskModelPreset = {
  label: string;
  modelId: string;
  providers: string[];
};

export type UtilityModelPreset = {
  label: string;
  modelId: string;
};

export type ModelPreset = {
  label: string;
  modelId: string;
  reasoning?: boolean;
  providerOnly?: string;
  providers?: string[];
};

// Unified model presets used across analysis/task/utility/synthesis selectors.
export const MODEL_PRESETS: ModelPreset[] = [
  {
    label: "GPT-OSS 20B",
    modelId: "openai/gpt-oss-20b",
    reasoning: true,
  },
  {
    label: "GPT-OSS 120B",
    modelId: "openai/gpt-oss-120b",
    reasoning: true,
    providers: ["sambanova", "groq", "cerebras"],
  },
  {
    label: "Qwen 3.5 397B A17B",
    modelId: "qwen/qwen3.5-397b-a17b",
    reasoning: true,
  },
  {
    label: "Claude Sonnet 4.6",
    modelId: "anthropic/claude-sonnet-4.6",
    reasoning: false,
  },
  {
    label: "Kimi K2 0905",
    modelId: "moonshotai/kimi-k2-0905",
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

export const ANALYSIS_MODEL_PRESETS: AnalysisModelPreset[] = MODEL_PRESETS.map(
  (preset) => ({
    label: preset.label,
    modelId: preset.modelId,
    reasoning: !!preset.reasoning,
    providerOnly: preset.providerOnly,
  })
);

export const TASK_MODEL_PRESETS: TaskModelPreset[] = MODEL_PRESETS.map(
  (preset) => ({
    label: preset.label,
    modelId: preset.modelId,
    providers: preset.providers ?? [],
  })
);

export const UTILITY_MODEL_PRESETS: UtilityModelPreset[] = MODEL_PRESETS.map(
  (preset) => ({
    label: preset.label,
    modelId: preset.modelId,
  })
);

export const DEFAULT_UTILITY_MODEL_ID = "openai/gpt-oss-20b";
export const DEFAULT_SYNTHESIS_MODEL_ID = "openai/gpt-oss-20b";

export function getAnalysisModelPreset(
  modelId: string
): AnalysisModelPreset | undefined {
  return ANALYSIS_MODEL_PRESETS.find((preset) => preset.modelId === modelId);
}
