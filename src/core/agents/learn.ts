import fs from "node:fs";
import path from "node:path";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { AppDatabase } from "../db/db";
import { log } from "../logger";

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

function renderAgentsMd(sections: Map<LearningCategory, string[]>): string {
  const lines = ["# Agent Memory", "", "Durable learnings extracted from agent sessions. Updated automatically at session end.", ""];
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

export async function extractSessionLearnings(
  model: LanguageModel,
  db: AppDatabase,
  sessionId: string,
): Promise<void> {
  const blocks = db.getBlocksForSession(sessionId);
  const agents = db.getAgentsForSession(sessionId);
  const completedAgents = agents.filter((a) => a.status === "completed" && a.result);

  if (blocks.length < 5 && completedAgents.length === 0) {
    return;
  }

  const existingMd = readAgentsMd();
  const existingSections = parseSections(existingMd);
  const existingItems = new Set(
    [...existingSections.values()].flat().map((s) => s.toLowerCase().trim()),
  );

  const agentSummaries = completedAgents
    .map((a) => `Task: ${a.task}\nResult: ${a.result}`)
    .join("\n---\n");

  const recentBlocks = blocks
    .slice(-30)
    .map((b) => `[${b.sourceLabel}] ${b.sourceText}${b.translation ? ` → ${b.translation}` : ""}`)
    .join("\n");

  const prompt = [
    "Extract durable learnings from this session that would be useful for future agents.",
    "Only extract facts, preferences, decisions, or glossary terms that are stable and reusable.",
    "Do NOT extract transient observations, one-time statuses, or speculative ideas.",
    "",
    "Existing learnings (do NOT duplicate these):",
    existingMd || "(none)",
    "",
    "Session transcript (last 30 blocks):",
    recentBlocks || "(no transcript blocks)",
    "",
    "Completed agent summaries:",
    agentSummaries || "(no completed agents)",
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

    writeAgentsMd(renderAgentsMd(existingSections));
    log("INFO", `Extracted ${newLearnings.length} new learnings to agents.md`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", `Learning extraction failed: ${message}`);
  }
}
