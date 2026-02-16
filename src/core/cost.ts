const VERTEX_PRICING = {
  audioInputPerToken: 1.0 / 1_000_000,
  textInputPerToken: 0.5 / 1_000_000,
  outputPerToken: 3.0 / 1_000_000,
} as const;

export type CostAccumulator = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
};

export function createCostAccumulator(): CostAccumulator {
  return { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0 };
}

export function addCost(
  acc: CostAccumulator,
  inputTokens: number,
  outputTokens: number,
  inputType: "audio" | "text"
): number {
  const inputRate = inputType === "audio"
    ? VERTEX_PRICING.audioInputPerToken
    : VERTEX_PRICING.textInputPerToken;
  const cost = (inputTokens * inputRate) + (outputTokens * VERTEX_PRICING.outputPerToken);
  acc.totalInputTokens += inputTokens;
  acc.totalOutputTokens += outputTokens;
  acc.totalCost += cost;
  return acc.totalCost;
}

export function resetCost(acc: CostAccumulator) {
  acc.totalInputTokens = 0;
  acc.totalOutputTokens = 0;
  acc.totalCost = 0;
}
