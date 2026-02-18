import { createServer, type Server } from "node:http";
import crypto from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { SecureCredentialStore } from "./secure-credential-store";

export const NOTION_MCP_URL = "https://mcp.notion.com/mcp";
export const NOTION_SSE_URL = "https://mcp.notion.com/sse";
export const NOTION_CALLBACK_HOST = "127.0.0.1";
export const NOTION_CALLBACK_PORT = 43199;
export const NOTION_CALLBACK_PATH = "/oauth/notion/callback";
export const NOTION_CALLBACK_URL = `http://${NOTION_CALLBACK_HOST}:${NOTION_CALLBACK_PORT}${NOTION_CALLBACK_PATH}`;

export type NotionOAuthFlowOptions = {
  store: SecureCredentialStore;
  openExternal: (url: string) => Promise<void>;
};

function randomState(): string {
  return crypto.randomBytes(18).toString("base64url");
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset=\"utf-8\"><title>${title}</title></head><body><h2>${title}</h2><p>${body}</p><p>You can close this window and return to Rosetta.</p></body></html>`;
}

export function createNotionOAuthProvider({
  store,
  openExternal,
}: NotionOAuthFlowOptions): OAuthClientProvider {
  return {
    get redirectUrl() {
      return NOTION_CALLBACK_URL;
    },

    get clientMetadata() {
      return {
        redirect_uris: [NOTION_CALLBACK_URL],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_name: "Rosetta Desktop MCP Client",
      };
    },

    async state() {
      const state = randomState();
      await store.setNotionPendingState(state);
      return state;
    },

    async clientInformation() {
      return store.getNotionClientInformation();
    },

    async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
      await store.setNotionClientInformation(clientInformation);
    },

    async tokens() {
      return store.getNotionTokens();
    },

    async saveTokens(tokens: OAuthTokens) {
      await store.setNotionTokens(tokens);
      await store.setNotionMetadata({
        label: "Connected",
        lastConnectedAt: Date.now(),
        lastError: undefined,
      });
    },

    async redirectToAuthorization(authorizationUrl: URL) {
      await openExternal(String(authorizationUrl));
    },

    async saveCodeVerifier(codeVerifier: string) {
      await store.setNotionCodeVerifier(codeVerifier);
    },

    async codeVerifier() {
      const verifier = await store.getNotionCodeVerifier();
      if (!verifier) {
        throw new Error("Missing PKCE code verifier for Notion OAuth flow.");
      }
      return verifier;
    },

    async invalidateCredentials(scope) {
      if (scope === "all" || scope === "tokens") {
        await store.setNotionTokens(undefined);
      }
      if (scope === "all" || scope === "client") {
        await store.setNotionClientInformation(undefined);
      }
      if (scope === "all" || scope === "verifier") {
        await store.setNotionCodeVerifier(undefined);
      }
    },
  };
}

export async function waitForNotionOAuthAuthorizationCode(options: {
  expectedState: string;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 180_000;

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    let server: Server | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (server) {
        server.close(() => fn());
      } else {
        fn();
      }
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Timed out waiting for OAuth callback.")));
    }, timeoutMs);

    server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", NOTION_CALLBACK_URL);
      if (reqUrl.pathname !== NOTION_CALLBACK_PATH) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const error = reqUrl.searchParams.get("error");
      const code = reqUrl.searchParams.get("code");
      const state = reqUrl.searchParams.get("state");

      if (error) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage("Notion connection failed", `OAuth returned error: ${error}`));
        clearTimeout(timeout);
        finish(() => reject(new Error(`OAuth error: ${error}`)));
        return;
      }

      if (!code) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage("Notion connection failed", "Missing authorization code."));
        return;
      }

      if (!state || state !== options.expectedState) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(htmlPage("Notion connection failed", "OAuth state did not match the expected value."));
        clearTimeout(timeout);
        finish(() => reject(new Error("OAuth state mismatch.")));
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(htmlPage("Notion connected", "Authorization complete."));
      clearTimeout(timeout);
      finish(() => resolve(code));
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      finish(() => reject(error));
    });

    server.listen(NOTION_CALLBACK_PORT, NOTION_CALLBACK_HOST);
  });
}
