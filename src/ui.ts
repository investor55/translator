// ANSI colors
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const CLEAR_LINE = "\x1b[2K\r";

let lastWasPartial = false;

export function printBanner(deviceName: string): void {
  console.log(`${BOLD}🎙️  Realtime Translator${RESET} ${DIM}- ${deviceName}${RESET}`);
  console.log(`${DIM}SPACE: start/pause • Q: quit${RESET}\n`);
}

export function printStatus(text: string): void {
  console.log(`${DIM}${text}${RESET}`);
}

export function printLine(label: "KR" | "EN", text: string): void {
  if (lastWasPartial) {
    process.stdout.write(CLEAR_LINE);
    lastWasPartial = false;
  }
  const color = label === "KR" ? CYAN : GREEN;
  console.log(`${BOLD}${color}${label}:${RESET} ${text}`);
}

export function printPartial(text: string): void {
  process.stdout.write(`${CLEAR_LINE}${DIM}... ${text}${RESET}`);
  lastWasPartial = true;
}

export function clearPartial(): void {
  if (lastWasPartial) {
    process.stdout.write(CLEAR_LINE);
    lastWasPartial = false;
  }
}
