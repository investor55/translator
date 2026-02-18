import { promises as fs } from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  IntegrationCredentialsFile,
  LinearCredentialRecord,
  NotionCredentialRecord,
} from "./types";

const EMPTY_FILE: IntegrationCredentialsFile = { version: 1 };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export class SecureCredentialStore {
  constructor(private readonly filePath: string) {}

  encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  ensureEncryptionAvailable(): void {
    if (!this.encryptionAvailable()) {
      throw new Error("Secure keychain encryption is unavailable on this system.");
    }
  }

  private encryptString(value: string): string {
    this.ensureEncryptionAvailable();
    return safeStorage.encryptString(value).toString("base64");
  }

  private decryptString(value?: string): string | undefined {
    if (!value) return undefined;
    this.ensureEncryptionAvailable();
    try {
      const buffer = Buffer.from(value, "base64");
      return safeStorage.decryptString(buffer);
    } catch {
      return undefined;
    }
  }

  private encryptJson(value: unknown): string {
    return this.encryptString(JSON.stringify(value));
  }

  private decryptJson<T>(value?: string): T | undefined {
    const raw = this.decryptString(value);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async readFile(): Promise<IntegrationCredentialsFile> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as IntegrationCredentialsFile;
      if (!parsed || parsed.version !== 1) {
        return clone(EMPTY_FILE);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return clone(EMPTY_FILE);
      }
      throw error;
    }
  }

  async writeFile(next: IntegrationCredentialsFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  async mutate(mutator: (current: IntegrationCredentialsFile) => IntegrationCredentialsFile): Promise<void> {
    const current = await this.readFile();
    const next = mutator(clone(current));
    await this.writeFile(next);
  }

  async getNotionTokens(): Promise<OAuthTokens | undefined> {
    const data = await this.readFile();
    return this.decryptJson<OAuthTokens>(data.notion?.tokensEncrypted);
  }

  async setNotionTokens(tokens: OAuthTokens | undefined): Promise<void> {
    await this.mutate((current) => {
      const notion: NotionCredentialRecord = current.notion ?? {};
      notion.tokensEncrypted = tokens ? this.encryptJson(tokens) : undefined;
      current.notion = notion;
      return current;
    });
  }

  async getNotionClientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const data = await this.readFile();
    return this.decryptJson<OAuthClientInformationMixed>(data.notion?.clientInformationEncrypted);
  }

  async setNotionClientInformation(info: OAuthClientInformationMixed | undefined): Promise<void> {
    await this.mutate((current) => {
      const notion: NotionCredentialRecord = current.notion ?? {};
      notion.clientInformationEncrypted = info ? this.encryptJson(info) : undefined;
      current.notion = notion;
      return current;
    });
  }

  async getNotionCodeVerifier(): Promise<string | undefined> {
    const data = await this.readFile();
    return this.decryptString(data.notion?.codeVerifierEncrypted);
  }

  async setNotionCodeVerifier(verifier: string | undefined): Promise<void> {
    await this.mutate((current) => {
      const notion: NotionCredentialRecord = current.notion ?? {};
      notion.codeVerifierEncrypted = verifier ? this.encryptString(verifier) : undefined;
      current.notion = notion;
      return current;
    });
  }

  async getNotionPendingState(): Promise<string | undefined> {
    const data = await this.readFile();
    return data.notion?.pendingState;
  }

  async setNotionPendingState(state: string | undefined): Promise<void> {
    await this.mutate((current) => {
      const notion: NotionCredentialRecord = current.notion ?? {};
      notion.pendingState = state;
      current.notion = notion;
      return current;
    });
  }

  async setNotionMetadata(input: { label?: string; lastConnectedAt?: number; lastError?: string }): Promise<void> {
    await this.mutate((current) => {
      const notion: NotionCredentialRecord = current.notion ?? {};
      notion.label = input.label;
      notion.lastConnectedAt = input.lastConnectedAt;
      notion.lastError = input.lastError;
      current.notion = notion;
      return current;
    });
  }

  async clearNotion(): Promise<void> {
    await this.mutate((current) => {
      current.notion = {
        label: current.notion?.label,
        lastConnectedAt: undefined,
        lastError: undefined,
      };
      return current;
    });
  }

  async getLinearToken(): Promise<string | undefined> {
    const data = await this.readFile();
    return this.decryptString(data.linear?.tokenEncrypted);
  }

  async setLinearToken(token: string | undefined): Promise<void> {
    await this.mutate((current) => {
      const linear: LinearCredentialRecord = current.linear ?? {};
      linear.tokenEncrypted = token ? this.encryptString(token) : undefined;
      current.linear = linear;
      return current;
    });
  }

  async setLinearMetadata(input: { label?: string; lastConnectedAt?: number; lastError?: string }): Promise<void> {
    await this.mutate((current) => {
      const linear: LinearCredentialRecord = current.linear ?? {};
      linear.label = input.label;
      linear.lastConnectedAt = input.lastConnectedAt;
      linear.lastError = input.lastError;
      current.linear = linear;
      return current;
    });
  }

  async clearLinear(): Promise<void> {
    await this.mutate((current) => {
      current.linear = {
        label: current.linear?.label,
        lastConnectedAt: undefined,
        lastError: undefined,
      };
      return current;
    });
  }
}
