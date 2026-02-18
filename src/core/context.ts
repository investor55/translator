import fs from "node:fs";
import path from "node:path";
import type { AudioSource, TranscriptBlock } from "./types";
import { normalizeText } from "./text/text-utils";

export type ContextState = {
  contextBuffer: string[];
  recentTranslations: Set<string>;
  recentTranslationQueue: string[];
  transcriptBlocks: Map<number, TranscriptBlock>;
  nextBlockId: number;
  allKeyPoints: string[];
};

const CONTEXT_WINDOW_SIZE = 10;
const RECENT_TRANSLATION_LIMIT = 20;

export function createContextState(): ContextState {
  return {
    contextBuffer: [],
    recentTranslations: new Set(),
    recentTranslationQueue: [],
    transcriptBlocks: new Map(),
    nextBlockId: 1,
    allKeyPoints: [],
  };
}

export function resetContextState(state: ContextState) {
  state.contextBuffer.length = 0;
  state.transcriptBlocks.clear();
  state.nextBlockId = 1;
  // Keep allKeyPoints across resets for session log
}

export function recordContext(state: ContextState, sentence: string) {
  state.contextBuffer.push(sentence);
  if (state.contextBuffer.length > CONTEXT_WINDOW_SIZE) {
    state.contextBuffer.shift();
  }
}

export function getContextWindow(state: ContextState): string[] {
  return state.contextBuffer.slice(-CONTEXT_WINDOW_SIZE);
}

export function rememberTranslation(state: ContextState, text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (state.recentTranslations.has(normalized)) return false;
  state.recentTranslations.add(normalized);
  state.recentTranslationQueue.push(normalized);
  if (state.recentTranslationQueue.length > RECENT_TRANSLATION_LIMIT) {
    const oldest = state.recentTranslationQueue.shift();
    if (oldest) state.recentTranslations.delete(oldest);
  }
  return true;
}

export function createBlock(
  state: ContextState,
  sourceLabel: string,
  sourceText: string,
  targetLabel: string,
  translation?: string,
  audioSource: AudioSource = "system"
): TranscriptBlock {
  const block: TranscriptBlock = {
    id: state.nextBlockId,
    sourceLabel,
    sourceText,
    targetLabel,
    translation,
    createdAt: Date.now(),
    audioSource,
  };
  state.transcriptBlocks.set(state.nextBlockId, block);
  state.nextBlockId += 1;
  return block;
}

export function loadUserContext(contextFile: string, useContext: boolean): string {
  if (!useContext) return "";
  const fullPath = path.resolve(contextFile);
  if (!fs.existsSync(fullPath)) return "";
  const raw = fs.readFileSync(fullPath, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*#+\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

export function writeSummaryLog(allKeyPoints: string[]) {
  if (allKeyPoints.length === 0) return;
  const summaryLogFile = path.join(process.cwd(), "summary.log");
  const ts = new Date().toISOString();
  const lines = [
    `\n--- Session: ${ts} ---`,
    ...allKeyPoints.map((p) => `\u2022 ${p}`),
    "",
  ].join("\n");
  fs.appendFileSync(summaryLogFile, lines);
}
