export type Direction = "auto" | "ko-en" | "en-ko";
export type FixedDirection = Exclude<Direction, "auto">;
export type Device = { index: number; name: string };

export type CliConfig = {
  device?: string;
  direction: Direction;
  intervalMs: number;
  modelId: string;
  listDevices: boolean;
  help: boolean;
  contextFile: string;
  useContext: boolean;
  compact: boolean;
};

export type TranscriptEntry = {
  id: number;
  korean?: string;
  english?: string;
  source: "ko" | "en";
};

export const DEFAULT_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? "claude-haiku-4-5-20251001";
export const DEFAULT_INTERVAL_MS = 3000;
