import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const encryptionState = vi.hoisted(() => ({ available: true }));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionState.available,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (value: Buffer) => {
      const raw = value.toString("utf8");
      if (!raw.startsWith("enc:")) {
        throw new Error("invalid encrypted value");
      }
      return raw.slice(4);
    },
  },
}));

import { SecureCredentialStore } from "./secure-credential-store";

describe("SecureCredentialStore", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    encryptionState.available = true;
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("round-trips encrypted Notion tokens", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-store-"));
    tempDirs.push(tempDir);
    const store = new SecureCredentialStore(path.join(tempDir, "integrations.credentials.json"));

    await store.setNotionTokens({
      access_token: "token-1",
      token_type: "Bearer",
      refresh_token: "refresh-1",
    });

    const loaded = await store.getNotionTokens();
    expect(loaded?.access_token).toBe("token-1");
    expect(loaded?.refresh_token).toBe("refresh-1");
  });

  it("fails writes when encryption is unavailable", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-store-"));
    tempDirs.push(tempDir);
    const store = new SecureCredentialStore(path.join(tempDir, "integrations.credentials.json"));

    encryptionState.available = false;
    await expect(store.setLinearToken("lin_api_test")).rejects.toThrow(
      "Secure keychain encryption is unavailable on this system.",
    );
  });
});
