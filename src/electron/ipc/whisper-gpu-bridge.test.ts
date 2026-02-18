import { describe, expect, it } from "vitest";
import {
  createWhisperGpuBridgeManager,
} from "./whisper-gpu-bridge-core";
import type {
  WhisperGpuReadyPayload,
  WhisperGpuRequest,
  WhisperGpuResponse,
} from "./whisper-gpu-types";

function createFakeTransport() {
  const sentRequests: WhisperGpuRequest[] = [];
  const responseListeners = new Set<(response: WhisperGpuResponse) => void>();
  const readyListeners = new Set<(payload: WhisperGpuReadyPayload) => void>();

  return {
    sentRequests,
    emitResponse(response: WhisperGpuResponse) {
      for (const listener of responseListeners) listener(response);
    },
    emitReady(payload: WhisperGpuReadyPayload) {
      for (const listener of readyListeners) listener(payload);
    },
    transport: {
      sendRequest(request: WhisperGpuRequest) {
        sentRequests.push(request);
        return true;
      },
      onResponse(callback: (response: WhisperGpuResponse) => void) {
        responseListeners.add(callback);
        return () => responseListeners.delete(callback);
      },
      onReady(callback: (payload: WhisperGpuReadyPayload) => void) {
        readyListeners.add(callback);
        return () => readyListeners.delete(callback);
      },
    },
  };
}

describe("createWhisperGpuBridgeManager", () => {
  it("correlates responses by request id", async () => {
    const fake = createFakeTransport();
    const bridge = createWhisperGpuBridgeManager(fake.transport, { requestTimeoutMs: 1000 });
    fake.emitReady({ supported: true });

    const first = bridge.runtime.preload("Xenova/whisper-base");
    const second = bridge.runtime.transcribe(
      new Float32Array([0.1, -0.2]),
      "Xenova/whisper-base",
      ["en"],
    );

    const [request1, request2] = fake.sentRequests;
    expect(request1.id).not.toBe(request2.id);

    fake.emitResponse({ id: request2.id, type: "result", text: "hello" });
    fake.emitResponse({ id: request1.id, type: "loaded" });

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe("hello");

    bridge.dispose();
  });

  it("times out pending requests", async () => {
    const fake = createFakeTransport();
    const bridge = createWhisperGpuBridgeManager(fake.transport, { requestTimeoutMs: 10 });
    fake.emitReady({ supported: true });

    await expect(bridge.runtime.preload("Xenova/whisper-base")).rejects.toThrow(
      /timed out/i,
    );
    bridge.dispose();
  });

  it("only reports ready when supported", async () => {
    const fake = createFakeTransport();
    const bridge = createWhisperGpuBridgeManager(fake.transport, { requestTimeoutMs: 1000 });

    expect(bridge.runtime.isReady()).toBe(false);
    fake.emitReady({ supported: false });
    expect(bridge.runtime.isReady()).toBe(false);
    await expect(bridge.runtime.preload("Xenova/whisper-base")).rejects.toThrow(
      /unavailable/i,
    );

    fake.emitReady({ supported: true });
    expect(bridge.runtime.isReady()).toBe(true);
    bridge.dispose();
  });
});
