// ANSI colors
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export type TranscriptBlock = {
  id: number;
  sourceLabel: "KR" | "EN";
  sourceText: string;
  targetLabel: "KR" | "EN";
  translation?: string;
};

export function enterFullscreen(): void {
  process.stdout.write(CLEAR_SCREEN + HIDE_CURSOR);
}

export function exitFullscreen(): void {
  process.stdout.write(SHOW_CURSOR + CLEAR_SCREEN);
}

export function clearScreen(): void {
  process.stdout.write(CLEAR_SCREEN);
}

export function printHeader(deviceName: string, modelId: string, intervalMs: number): void {
  const interval = `${(intervalMs / 1000).toFixed(1)}s`;
  console.log(`${BOLD}🎙️  Realtime Translator${RESET} ${DIM}- ${deviceName}${RESET}`);
  console.log(`${DIM}Model:${RESET} ${modelId}  ${DIM}Flush:${RESET} ${interval}`);
  console.log(`${DIM}SPACE: start/pause • Q: quit${RESET}\n`);
}

export function printStatus(text: string): void {
  console.log(`${DIM}${text}${RESET}`);
}

export function printBlock(block: TranscriptBlock, compact = false): void {
  const index = block.id.toString().padStart(3, "0");
  const sourceColor = block.sourceLabel === "KR" ? CYAN : GREEN;
  const targetColor = block.targetLabel === "KR" ? CYAN : GREEN;

  if (!compact) {
    console.log(`${DIM}— ${index} —${RESET}`);
  }

  console.log(`${BOLD}${sourceColor}${block.sourceLabel}:${RESET} ${block.sourceText}`);

  if (block.translation) {
    console.log(`${BOLD}${targetColor}${block.targetLabel}:${RESET} ${block.translation}`);
  } else {
    console.log(`${DIM}${block.targetLabel}:${RESET} …`);
  }

  if (!compact) {
    console.log("");
  }
}
