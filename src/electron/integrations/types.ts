import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpIntegrationStatus, CustomMcpTransport, CustomMcpStatus, McpProviderToolSummary } from "../../core/types";
import type { AgentExternalToolSet } from "../../core/agents/external-tools";

export type IntegrationProvider = "notion" | "linear";

export type NotionCredentialRecord = {
  tokensEncrypted?: string;
  clientInformationEncrypted?: string;
  codeVerifierEncrypted?: string;
  pendingState?: string;
  label?: string;
  lastConnectedAt?: number;
  lastError?: string;
};

export type LinearCredentialRecord = {
  tokenEncrypted?: string;
  label?: string;
  lastConnectedAt?: number;
  lastError?: string;
};

export type CustomMcpServerRecord = {
  id: string;
  name: string;
  url: string;
  transport: "streamable" | "sse";
  tokenEncrypted?: string;
  label?: string;
  lastConnectedAt?: number;
  lastError?: string;
};

export type IntegrationCredentialsFile = {
  version: 1;
  notion?: NotionCredentialRecord;
  linear?: LinearCredentialRecord;
  customServers?: CustomMcpServerRecord[];
};

export type IntegrationSecretPayload = {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformationMixed;
  codeVerifier?: string;
  linearToken?: string;
};

export type IntegrationManager = {
  readonly enabled: boolean;
  getStatus: () => Promise<McpIntegrationStatus[]>;
  connectNotion: () => Promise<{ ok: boolean; error?: string }>;
  disconnectNotion: () => Promise<{ ok: boolean; error?: string }>;
  setLinearToken: (token: string) => Promise<{ ok: boolean; error?: string }>;
  clearLinearToken: () => Promise<{ ok: boolean; error?: string }>;
  getExternalTools: () => Promise<AgentExternalToolSet>;
  dispose: () => Promise<void>;
  addCustomMcpServer: (cfg: { name: string; url: string; transport: CustomMcpTransport; bearerToken?: string }) => Promise<{ ok: boolean; error?: string; id?: string }>;
  removeCustomMcpServer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  connectCustomMcpServer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectCustomMcpServer: (id: string) => Promise<{ ok: boolean; error?: string }>;
  getCustomMcpServersStatus: () => Promise<CustomMcpStatus[]>;
  getMcpToolsInfo: () => Promise<McpProviderToolSummary[]>;
};
