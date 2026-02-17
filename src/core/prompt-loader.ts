import fs from "node:fs";
import path from "node:path";

const SUMMARY_PROMPT_PATH = path.join("prompts", "summary", "system.md");
const INSIGHTS_PROMPT_PATH = path.join("prompts", "insights", "system.md");

const DEFAULT_SUMMARY_SYSTEM_PROMPT = `You produce concise conversation key points for a live transcript.

Task:
- Return 2-4 key points as specific, verifiable facts from the current conversation window.

Rules:
- Prioritize concrete details: names, places, dates, numbers, decisions, constraints.
- One sentence per key point.
- Do not include filler like "they discussed several topics."
- Keep points tightly tied to what was actually said.`;

const DEFAULT_INSIGHTS_SYSTEM_PROMPT = `You generate educational insights that help explain topics mentioned in the transcript.

Task:
- Return 1-3 short educational insights.

Rules:
- Each insight must be directly related to entities or concepts explicitly mentioned.
- Insights must teach context, definitions, facts, or practical tips.
- Do not summarize the conversation.
- Do not speculate or invent unsupported claims.
- If no meaningful topic is present, return an empty insights list.

Good examples:
- If they mention "Kubernetes": "Kubernetes is an open-source container orchestration platform originally developed at Google and now governed by CNCF."
- If they mention "CAC": "Customer Acquisition Cost (CAC) is total sales and marketing spend divided by the number of newly acquired customers."

Bad examples:
- "They discussed Kubernetes." (summary, not educational)
- "The conversation covered many topics." (filler)`;

function loadPrompt(relativePath: string, fallback: string): string {
  const fullPath = path.join(process.cwd(), relativePath);
  try {
    if (!fs.existsSync(fullPath)) return fallback;
    const content = fs.readFileSync(fullPath, "utf-8").trim();
    return content.length > 0 ? content : fallback;
  } catch {
    return fallback;
  }
}

export function getSummarySystemPrompt(): string {
  return loadPrompt(SUMMARY_PROMPT_PATH, DEFAULT_SUMMARY_SYSTEM_PROMPT);
}

export function getInsightsSystemPrompt(): string {
  return loadPrompt(INSIGHTS_PROMPT_PATH, DEFAULT_INSIGHTS_SYSTEM_PROMPT);
}
