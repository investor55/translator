import fs from "node:fs";
import path from "node:path";

const LOG_FILE = path.join(process.cwd(), "translator.log");

export function log(level: "INFO" | "ERROR" | "WARN", msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level}: ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}
