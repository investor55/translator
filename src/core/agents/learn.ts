import fs from "node:fs";
import path from "node:path";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { loadProjectAgentsMd, writeProjectAgentsMd } from "../context";
import { log } from "../logger";
import type { Agent, TranscriptBlock } from "../types";

const AGENTS_MD_PATH = path.resolve(process.cwd(), "agents.md");

const LEARNING_CATEGORIES = ["Facts", "Preferences", "Decisions", "Glossary"] as const;
type LearningCategory = (typeof LEARNING_CATEGORIES)[number];

const learningSchema = z.object({
  learnings: z.array(
    z.object({
      category: z.enum(LEARNING_CATEGORIES),
      text: z.string().describe("A single durable learning — concise, self-contained"),
    }),
  ),
});

function readAgentsMd(): string {
  if (!fs.existsSync(AGENTS_MD_PATH)) return "";
  return fs.readFileSync(AGENTS_MD_PATH, "utf-8");
}

function writeAgentsMd(content: string) {
  fs.writeFileSync(AGENTS_MD_PATH, content, "utf-8");
}

function parseSections(md: string): Map<LearningCategory, string[]> {
  const sections = new Map<LearningCategory, string[]>();
  for (const cat of LEARNING_CATEGORIES) sections.set(cat, []);

  let current: LearningCategory | null = null;
  for (const line of md.split("\n")) {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      const name = headerMatch[1].trim() as LearningCategory;
      if (LEARNING_CATEGORIES.includes(name)) {
        current = name;
      } else {
        current = null;
      }
      continue;
    }
    if (current && line.trim().startsWith("- ")) {
      sections.get(current)!.push(line.trim().slice(2).trim());
    }
  }
  return sections;
}

function formatAgentConversation(agent: Agent): string {
  const lines = [`Task: ${agent.task}`];
  for (const step of agent.steps) {
    if (step.kind === "user") {
      lines.push(`User: ${step.content}`);
    } else if (step.kind === "text") {
      lines.push(`Agent: ${step.content.slice(0, 500)}`);
    }
  }
  if (agent.result) {
    lines.push(`Final result: ${agent.result}`);
  }
  return lines.join("\n");
}

function renderAgentsMd(sections: Map<LearningCategory, string[]>): string {
  const lines = ["# Agent Memory", "", "Durable learnings extracted from agent sessions. Updated automatically.", ""];
  for (const cat of LEARNING_CATEGORIES) {
    lines.push(`## ${cat}`, "");
    const items = sections.get(cat) ?? [];
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function extractAgentLearnings(
  model: LanguageModel,
  agent: Agent,
  recentBlocks: TranscriptBlock[],
  projectId?: string,
  dataDir?: string,
): Promise<void> {
  if (!agent.result) return;

  const hasUserCorrections = agent.steps.some((s) => s.kind === "user");
  if (!hasUserCorrections) return;

  log("INFO", `Learning extraction for agent ${agent.id} (project: ${projectId ?? "none"})`);

  const existingMd = (projectId && dataDir)
    ? loadProjectAgentsMd(dataDir, projectId)
    : readAgentsMd();
  const existingSections = parseSections(existingMd);
  const existingItems = new Set(
    [...existingSections.values()].flat().map((s) => s.toLowerCase().trim()),
  );

  const conversation = formatAgentConversation(agent);

  const blockContext = recentBlocks
    .slice(-20)
    .map((b) => `[${b.sourceLabel}] ${b.sourceText}${b.translation ? ` → ${b.translation}` : ""}`)
    .join("\n");

  const prompt = [
    "Analyze this agent conversation for moments where the USER CORRECTED the agent or OVERRODE its behavior.",
    "Only extract learnings from explicit user pushback — where the agent did something wrong and the user told it to do something different.",
    "",
    "EXTRACT when:",
    "- The user said 'no, do X instead' or 'stop doing Y'",
    "- The user rejected the agent's approach and provided a different one",
    "- The user expressed frustration with the agent's behavior and corrected it",
    "- The user provided a domain-specific term or glossary correction",
    "",
    "DO NOT extract:",
    "- Generic AI assistant best practices (e.g., 'present data in tables', 'acknowledge user frustrations')",
    "- Anything the agent did correctly that the user accepted without comment",
    "- Learnings that any competent LLM already knows how to do",
    "- One-off task instructions or transient details",
    "- Specific facts/data points (names, versions, dates) that go stale",
    "- Secrets, tokens, credentials",
    "",
    "The bar is HIGH. Most conversations produce zero learnings. Return an empty array unless there is a clear user correction.",
    "",
    "Existing learnings (do NOT duplicate these):",
    existingMd || "(none)",
    "",
    "Recent transcript context:",
    blockContext || "(no transcript)",
    "",
    "Agent conversation:",
    conversation,
  ].join("\n");

  try {
    const { object } = await generateObject({
      model,
      schema: learningSchema,
      prompt,
      abortSignal: AbortSignal.timeout(30_000),
    });

    const newLearnings = object.learnings.filter(
      (l) => !existingItems.has(l.text.toLowerCase().trim()),
    );

    if (newLearnings.length === 0) return;

    for (const learning of newLearnings) {
      existingSections.get(learning.category)!.push(learning.text);
    }

    const rendered = renderAgentsMd(existingSections);
    if (projectId && dataDir) {
      writeProjectAgentsMd(dataDir, projectId, rendered);
      log("INFO", `Extracted ${newLearnings.length} new learnings for project ${projectId}`);
    } else {
      writeAgentsMd(rendered);
      log("INFO", `Extracted ${newLearnings.length} new learnings to agents.md`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", `Learning extraction failed: ${message}`);
  }
}
