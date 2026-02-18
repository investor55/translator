import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpIntegrationStatus } from "../../core/types";
import type { AgentExternalToolSet, AgentExternalToolProvider } from "../../core/agents/external-tools";
import { log } from "../../core/logger";
import {
  createNotionOAuthProvider,
  NOTION_MCP_URL,
  NOTION_SSE_URL,
  waitForNotionOAuthAuthorizationCode,
} from "./notion-oauth-client";
import { SecureCredentialStore } from "./secure-credential-store";

const LINEAR_MCP_URL = "https://mcp.linear.app/mcp";
const CLIENT_INFO = {
  name: "rosetta-mcp-client",
  version: "1.0.0",
};

const MUTATING_NAME_PATTERN = /(create|update|delete|archive|restore|comment|append|move|set|edit|close|complete|assign)/i;

type ProviderRuntime = {
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
  toolCache?: AgentExternalToolSet;
};

type NotionTransportKind = "streamable" | "sse";

export function isMutatingToolName(name: string): boolean {
  return MUTATING_NAME_PATTERN.test(name);
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function classifyMutatingTool(
  provider: AgentExternalToolProvider,
  tool: ListToolsResult["tools"][number],
): boolean {
  if (tool.annotations?.readOnlyHint === true) return false;
  if (tool.annotations?.destructiveHint === true) return true;

  const name = tool.name.toLowerCase();
  if (provider === "linear") {
    if (name.startsWith("get") || name.startsWith("list") || name.startsWith("search")) {
      return false;
    }
  }
  return isMutatingToolName(name);
}

function isUnauthorizedLike(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/unauthorized/i.test(message)) return true;
  const withStatus = error as { statusCode?: number; status?: number; code?: number } | null;
  return withStatus?.statusCode === 401 || withStatus?.status === 401 || withStatus?.code === 401;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

async function closeRuntime(runtime?: ProviderRuntime): Promise<void> {
  if (!runtime) return;
  try {
    await runtime.client.close();
  } catch {
    // no-op
  }
}

export function createMcpToolRegistry(options: {
  enabled: boolean;
  store: SecureCredentialStore;
  openExternal: (url: string) => Promise<void>;
}) {
  const { enabled, store, openExternal } = options;

  let notionRuntime: ProviderRuntime | undefined;
  let linearRuntime: ProviderRuntime | undefined;

  function createNotionRuntime(kind: NotionTransportKind): ProviderRuntime {
    const provider = createNotionOAuthProvider({ store, openExternal });
    const transport = kind === "streamable"
      ? new StreamableHTTPClientTransport(new URL(NOTION_MCP_URL), {
        authProvider: provider,
      })
      : new SSEClientTransport(new URL(NOTION_SSE_URL), {
        authProvider: provider,
      });
    const client = new Client(CLIENT_INFO);
    return { client, transport };
  }

  async function authenticateNotionRuntime(runtime: ProviderRuntime, kind: NotionTransportKind): Promise<void> {
    try {
      await runtime.client.connect(runtime.transport);
      await runtime.client.listTools();
      return;
    } catch (error) {
      if (!isUnauthorizedLike(error)) {
        throw error;
      }
      log("INFO", `Notion ${kind} requested interactive OAuth authorization.`);
    }

    const expectedState = await store.getNotionPendingState();
    if (!expectedState) {
      throw new Error("OAuth flow started but no pending state was recorded.");
    }

    const code = await waitForNotionOAuthAuthorizationCode({ expectedState });
    log("INFO", `Notion OAuth callback received for ${kind}. Exchanging authorization code.`);
    await runtime.transport.finishAuth(code);
    await runtime.client.listTools();
  }

  async function buildAgentToolsForProvider(
    provider: AgentExternalToolProvider,
    runtime: ProviderRuntime,
  ): Promise<AgentExternalToolSet> {
    if (runtime.toolCache) {
      return runtime.toolCache;
    }

    const { tools } = await runtime.client.listTools();
    const mapped: AgentExternalToolSet = {};

    for (const tool of tools) {
      const prefixedName = `${provider}__${tool.name}`;
      const isMutating = classifyMutatingTool(provider, tool);

      mapped[prefixedName] = {
        name: prefixedName,
        provider,
        description: tool.description ?? `${provider} MCP tool: ${tool.name}`,
        inputSchema: tool.inputSchema,
        isMutating,
        execute: async (input, execOptions) => {
          const result = await runtime.client.callTool(
            {
              name: tool.name,
              arguments: normalizeToolInput(input),
            },
            undefined,
            { signal: execOptions.abortSignal },
          );

          if ("structuredContent" in result && result.structuredContent != null) {
            return result.structuredContent;
          }
          if ("toolResult" in result) {
            return result.toolResult;
          }
          return result;
        },
      };
    }

    runtime.toolCache = mapped;
    return mapped;
  }

  async function ensureLinearRuntime(): Promise<ProviderRuntime | undefined> {
    if (!enabled) return undefined;
    const token = await store.getLinearToken();
    if (!token) return undefined;

    if (linearRuntime) return linearRuntime;

    const transport = new StreamableHTTPClientTransport(new URL(LINEAR_MCP_URL), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
    const client = new Client(CLIENT_INFO);
    await client.connect(transport);
    linearRuntime = { client, transport };
    return linearRuntime;
  }

  async function ensureNotionRuntime(): Promise<ProviderRuntime | undefined> {
    if (!enabled) return undefined;
    const tokens = await store.getNotionTokens();
    if (!tokens) return undefined;

    if (notionRuntime) return notionRuntime;

    const streamableRuntime = createNotionRuntime("streamable");
    try {
      await streamableRuntime.client.connect(streamableRuntime.transport);
      await streamableRuntime.client.listTools();
      notionRuntime = streamableRuntime;
      return notionRuntime;
    } catch (streamableError) {
      await closeRuntime(streamableRuntime);
      log("WARN", `Notion streamable runtime unavailable, trying SSE fallback: ${formatError(streamableError)}`);
    }

    const sseRuntime = createNotionRuntime("sse");
    await sseRuntime.client.connect(sseRuntime.transport);
    await sseRuntime.client.listTools();
    notionRuntime = sseRuntime;
    return notionRuntime;
  }

  async function connectNotion(): Promise<{ ok: boolean; error?: string }> {
    if (!enabled) {
      return { ok: false, error: "MCP integrations are disabled. Set MCP_INTEGRATIONS_ENABLED=true (or remove MCP_INTEGRATIONS_ENABLED=false)." };
    }

    try {
      store.ensureEncryptionAvailable();
      await closeRuntime(notionRuntime);
      notionRuntime = undefined;
      await store.setNotionPendingState(undefined);
      await store.setNotionCodeVerifier(undefined);
      await store.setNotionTokens(undefined);
      await store.setNotionClientInformation(undefined);
      log("INFO", "Starting Notion MCP connect using streamable transport.");

      let runtime = createNotionRuntime("streamable");
      try {
        await authenticateNotionRuntime(runtime, "streamable");
      } catch (streamableError) {
        await closeRuntime(runtime);
        log("WARN", `Notion streamable connect failed, trying SSE fallback: ${formatError(streamableError)}`);
        runtime = createNotionRuntime("sse");
        await authenticateNotionRuntime(runtime, "sse");
      }

      await store.setNotionPendingState(undefined);
      await store.setNotionCodeVerifier(undefined);
      await store.setNotionMetadata({
        label: "Connected",
        lastConnectedAt: Date.now(),
        lastError: undefined,
      });

      notionRuntime = runtime;
      return { ok: true };
    } catch (error) {
      const message = formatError(error);
      await store.setNotionPendingState(undefined);
      await store.setNotionCodeVerifier(undefined);
      await store.setNotionMetadata({
        label: "Disconnected",
        lastConnectedAt: undefined,
        lastError: message,
      });
      log("ERROR", `Notion MCP connect failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async function disconnectNotion(): Promise<{ ok: boolean; error?: string }> {
    await closeRuntime(notionRuntime);
    notionRuntime = undefined;
    await store.clearNotion();
    return { ok: true };
  }

  async function setLinearToken(token: string): Promise<{ ok: boolean; error?: string }> {
    if (!enabled) {
      return { ok: false, error: "MCP integrations are disabled. Set MCP_INTEGRATIONS_ENABLED=true (or remove MCP_INTEGRATIONS_ENABLED=false)." };
    }

    try {
      store.ensureEncryptionAvailable();
      const trimmed = token.trim();
      if (!trimmed) {
        return { ok: false, error: "Linear token is required." };
      }

      await store.setLinearToken(trimmed);
      await closeRuntime(linearRuntime);
      linearRuntime = undefined;

      const runtime = await ensureLinearRuntime();
      if (!runtime) {
        throw new Error("Could not initialize Linear MCP runtime.");
      }

      await runtime.client.listTools();
      await store.setLinearMetadata({
        label: "Connected",
        lastConnectedAt: Date.now(),
        lastError: undefined,
      });

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.setLinearMetadata({
        label: "Disconnected",
        lastConnectedAt: undefined,
        lastError: message,
      });
      await closeRuntime(linearRuntime);
      linearRuntime = undefined;
      log("ERROR", `Linear MCP connect failed: ${message}`);
      return { ok: false, error: message };
    }
  }

  async function clearLinearToken(): Promise<{ ok: boolean; error?: string }> {
    await closeRuntime(linearRuntime);
    linearRuntime = undefined;
    await store.clearLinear();
    return { ok: true };
  }

  async function getStatus(): Promise<McpIntegrationStatus[]> {
    const data = await store.readFile();
    let notionHasTokens = false;
    let linearHasToken = false;
    let encryptionError: string | undefined;
    try {
      notionHasTokens = !!(await store.getNotionTokens());
      linearHasToken = !!(await store.getLinearToken());
    } catch (error) {
      encryptionError = error instanceof Error ? error.message : String(error);
    }

    const notionState: McpIntegrationStatus = {
      provider: "notion",
      mode: "oauth",
      enabled,
      state: !enabled
        ? "disconnected"
        : encryptionError
        ? "error"
        : data.notion?.lastError
        ? "error"
        : notionHasTokens
        ? "connected"
        : "disconnected",
      label: data.notion?.label,
      error: encryptionError ?? data.notion?.lastError,
      lastConnectedAt: data.notion?.lastConnectedAt,
    };

    const linearState: McpIntegrationStatus = {
      provider: "linear",
      mode: "token",
      enabled,
      state: !enabled
        ? "disconnected"
        : encryptionError
        ? "error"
        : data.linear?.lastError
        ? "error"
        : linearHasToken
        ? "connected"
        : "disconnected",
      label: data.linear?.label,
      error: encryptionError ?? data.linear?.lastError,
      lastConnectedAt: data.linear?.lastConnectedAt,
    };

    return [notionState, linearState];
  }

  async function getExternalTools(): Promise<AgentExternalToolSet> {
    if (!enabled) return {};

    const merged: AgentExternalToolSet = {};

    try {
      const runtime = await ensureNotionRuntime();
      if (runtime) {
        Object.assign(merged, await buildAgentToolsForProvider("notion", runtime));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.setNotionMetadata({
        label: "Disconnected",
        lastConnectedAt: undefined,
        lastError: message,
      });
      log("WARN", `Notion MCP tools unavailable: ${message}`);
    }

    try {
      const runtime = await ensureLinearRuntime();
      if (runtime) {
        Object.assign(merged, await buildAgentToolsForProvider("linear", runtime));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.setLinearMetadata({
        label: "Disconnected",
        lastConnectedAt: undefined,
        lastError: message,
      });
      log("WARN", `Linear MCP tools unavailable: ${message}`);
    }

    return merged;
  }

  async function dispose(): Promise<void> {
    await closeRuntime(notionRuntime);
    notionRuntime = undefined;
    await closeRuntime(linearRuntime);
    linearRuntime = undefined;
  }

  return {
    enabled,
    connectNotion,
    disconnectNotion,
    setLinearToken,
    clearLinearToken,
    getStatus,
    getExternalTools,
    dispose,
  };
}
