export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

const TODO_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "that",
  "this",
  "is",
  "be",
  "are",
  "should",
  "need",
  "needs",
  "please",
  "todo",
  "task",
  "remind",
  "me",
]);

export function normalizeTodoText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(\d+)(am|pm)\b/g, "$1 $2")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeTodoToken(token: string): string {
  if (!token) return token;
  if (/^[a-z]{5,}es$/.test(token)) return token.slice(0, -2);
  if (/^[a-z]{4,}s$/.test(token)) return token.slice(0, -1);
  return token;
}

function todoTokenSet(text: string): Set<string> {
  const normalized = normalizeTodoText(text);
  if (!normalized) return new Set();
  return new Set(
    normalized
      .split(" ")
      .map((token) => canonicalizeTodoToken(token.trim()))
      .filter((token) => token.length > 1 && !TODO_STOP_WORDS.has(token))
  );
}

export function isLikelyDuplicateTodoText(left: string, right: string): boolean {
  const a = normalizeTodoText(left);
  const b = normalizeTodoText(right);

  if (!a || !b) return false;
  if (a === b) return true;

  // Strong containment for longer strings catches minor phrasing changes.
  if ((a.length >= 16 && b.includes(a)) || (b.length >= 16 && a.includes(b))) {
    return true;
  }

  const aTokens = todoTokenSet(a);
  const bTokens = todoTokenSet(b);
  if (aTokens.size === 0 || bTokens.size === 0) return false;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  if (overlap === 0) return false;

  const minSize = Math.min(aTokens.size, bTokens.size);
  const unionSize = aTokens.size + bTokens.size - overlap;
  const containment = overlap / minSize;
  const jaccard = overlap / unionSize;

  if (containment >= 1 && minSize >= 2) return true;
  if (containment >= 0.8 && overlap >= 3) return true;
  if (jaccard >= 0.6 && overlap >= 3) return true;

  return false;
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
