import type { LanguageCode } from "./intro-screen";

export type Direction = "auto" | "source-target";
export type Engine = "elevenlabs" | "vertex";
export type Device = { index: number; name: string };

export type CliConfig = {
  device?: string;
  direction: Direction;
  sourceLang: LanguageCode; // ISO 639-1 code for input language
  targetLang: LanguageCode; // ISO 639-1 code for output language
  intervalMs: number;
  modelId: string;
  engine: Engine;
  vertexModelId: string;
  vertexProject?: string;
  vertexLocation: string;
  listDevices: boolean;
  help: boolean;
  contextFile: string;
  useContext: boolean;
  compact: boolean;
  debug: boolean;
  skipIntro: boolean; // Skip intro screen and use CLI-provided languages
};

export type Summary = {
  keyPoints: string[];
  updatedAt: number;
};

export const DEFAULT_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? "claude-haiku-4-5-20251001";
export const DEFAULT_VERTEX_MODEL_ID =
  process.env.VERTEX_MODEL_ID ?? "gemini-3-flash-preview";
export const DEFAULT_VERTEX_LOCATION =
  process.env.GOOGLE_VERTEX_PROJECT_LOCATION ?? "global";
export const DEFAULT_INTERVAL_MS = 2000;
