export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function cleanTranslationOutput(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";
  const filtered = lines.filter(
    (line) =>
      !/^#/.test(line) &&
      !/^translation\b/i.test(line) &&
      !/^explanation\b/i.test(line) &&
      !/^breakdown\b/i.test(line)
  );
  const candidate = (filtered[0] ?? lines[0]).trim();
  return candidate.replace(/^[-\u2013\u2014]\s+/, "");
}

export function toReadableError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    if ("message" in e && typeof e.message === "string") return e.message;
    if ("name" in e && typeof e.name === "string") return e.name;
  }
  if (typeof e === "string") return e;
  return "Unknown error";
}
