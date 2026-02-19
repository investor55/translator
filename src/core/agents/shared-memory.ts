import { log } from "../logger";

const MEM0_API_BASE_URL = "https://api.mem0.ai";
const MEMORY_LIMIT = 8;
const MEMORY_SCORE_THRESHOLD = 0.35;
const MEM0_CUSTOM_INSTRUCTIONS =
  "Store only durable user/project facts, stable preferences, constraints, decisions, and unresolved commitments. " +
  "Do not store transient chit-chat, speculative thoughts, or one-off temporary statuses unless they are explicit action items.";

type SharedMemoryScope = {
  projectId?: string;
  sessionId?: string;
  agentId?: string;
};

export type SharedMemoryQuery = SharedMemoryScope & {
  query: string;
};

export type SharedMemoryRecord = SharedMemoryScope & {
  task: string;
  result: string;
  taskContext?: string;
};

export type SharedMemoryStore = {
  getContext: (query: SharedMemoryQuery) => Promise<string | undefined>;
  remember: (record: SharedMemoryRecord) => Promise<void>;
};

type Mem0Config = {
  apiKey: string;
  orgId?: string;
  projectId?: string;
  baseUrl?: string;
};

type Mem0SearchResult = {
  memory?: string;
  text?: string;
  score?: number;
};

function ensureTrailingPath(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function buildAppId(projectId?: string): string {
  const scope = projectId?.trim();
  return scope ? `ambient:project:${scope}` : "ambient:global";
}

function trimLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, max = 1200): string {
  const normalized = text.trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseSearchResults(payload: unknown): Mem0SearchResult[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({
        memory: typeof item.memory === "string" ? item.memory : undefined,
        text: typeof item.text === "string" ? item.text : undefined,
        score: typeof item.score === "number" ? item.score : undefined,
      }));
  }

  const objectPayload = asRecord(payload);
  if (!objectPayload) return [];

  if (Array.isArray(objectPayload.results)) {
    return parseSearchResults(objectPayload.results);
  }

  if (Array.isArray(objectPayload.memories)) {
    return parseSearchResults(objectPayload.memories);
  }

  return [];
}

export function createMem0SharedMemoryFromEnv(): SharedMemoryStore | null {
  const apiKey = process.env.MEM0_API_KEY?.trim();
  if (!apiKey) return null;

  return createMem0SharedMemory({
    apiKey,
    orgId: process.env.MEM0_ORG_ID?.trim() || undefined,
    projectId: process.env.MEM0_PROJECT_ID?.trim() || undefined,
  });
}

export function createMem0SharedMemory(config: Mem0Config): SharedMemoryStore {
  const baseUrl = ensureTrailingPath(config.baseUrl ?? MEM0_API_BASE_URL);
  const defaultProjectId = config.projectId?.trim() || undefined;
  const defaultOrgId = config.orgId?.trim() || undefined;
  const authHeader = `Token ${config.apiKey.trim()}`;

  async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = (await response.text()).trim();
      throw new Error(
        `Mem0 ${path} failed (${response.status}): ${errorText || response.statusText}`,
      );
    }

    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return {
    async getContext(query) {
      const normalizedQuery = query.query.trim();
      if (!normalizedQuery) return undefined;

      const projectId = query.projectId?.trim() || defaultProjectId;
      const appId = buildAppId(projectId);

      const body: Record<string, unknown> = {
        query: normalizedQuery,
        version: "v2",
        top_k: MEMORY_LIMIT,
        threshold: MEMORY_SCORE_THRESHOLD,
        filters: {
          AND: [{ app_id: appId }],
        },
      };

      if (defaultOrgId) body.org_id = defaultOrgId;
      if (defaultProjectId) body.project_id = defaultProjectId;

      const payload = await post("/v2/memories/search", body);
      const items = parseSearchResults(payload)
        .map((item) => item.memory ?? item.text ?? "")
        .map((item) => trimLine(item))
        .filter(Boolean)
        .slice(0, MEMORY_LIMIT);

      if (items.length === 0) return undefined;

      return items.map((item, idx) => `${idx + 1}. ${item}`).join("\n");
    },

    async remember(record) {
      const task = trimLine(record.task);
      const result = trimLine(record.result);
      if (!task || !result) return;

      const projectId = record.projectId?.trim() || defaultProjectId;
      const appId = buildAppId(projectId);
      const metadata: Record<string, unknown> = {
        source: "ambient-agent",
      };
      if (record.sessionId) metadata.session_id = record.sessionId;
      if (record.projectId) metadata.project_id = record.projectId;
      if (record.agentId) metadata.agent_id = record.agentId;

      const contextText = record.taskContext?.trim()
        ? `\nContext: ${clip(trimLine(record.taskContext), 800)}`
        : "";

      const body: Record<string, unknown> = {
        messages: [
          { role: "user", content: `Task: ${clip(task, 1200)}${contextText}` },
          { role: "assistant", content: `Result: ${clip(result, 1600)}` },
        ],
        version: "v2",
        custom_instructions: MEM0_CUSTOM_INSTRUCTIONS,
        app_id: appId,
        run_id: record.sessionId ?? undefined,
        agent_id: record.agentId ?? "ambient-agent",
        metadata,
      };

      if (defaultOrgId) body.org_id = defaultOrgId;
      if (defaultProjectId) body.project_id = defaultProjectId;

      await post("/v1/memories", body);
    },
  };
}

export async function safeGetSharedMemoryContext(
  store: SharedMemoryStore | null,
  query: SharedMemoryQuery,
): Promise<string | undefined> {
  if (!store) return undefined;
  try {
    return await store.getContext(query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", `Shared memory lookup failed: ${message}`);
    return undefined;
  }
}

export async function safeRememberSharedMemory(
  store: SharedMemoryStore | null,
  record: SharedMemoryRecord,
): Promise<void> {
  if (!store) return;
  try {
    await store.remember(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", `Shared memory write failed: ${message}`);
  }
}
