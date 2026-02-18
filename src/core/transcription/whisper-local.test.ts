import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhisperRemoteRuntime } from "./whisper-local";
import {
  __resetWhisperRuntimeStateForTest,
  __setWhisperCpuRuntimeForTest,
  disposeWhisperPipeline,
  preloadWhisperPipeline,
  setWhisperRemoteRuntime,
  transcribeWithWhisper,
} from "./whisper-local";

function makePcmBuffer(samples: number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, index * 2);
  });
  return buffer;
}

describe("whisper-local runtime routing", () => {
  beforeEach(() => {
    __resetWhisperRuntimeStateForTest();
  });

  it("uses renderer runtime when available", async () => {
    const cpu = {
      preload: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => "cpu transcript"),
      dispose: vi.fn(),
    };
    const remote: WhisperRemoteRuntime = {
      isReady: () => true,
      preload: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => "remote transcript"),
      dispose: vi.fn(),
    };

    __setWhisperCpuRuntimeForTest(cpu);
    setWhisperRemoteRuntime(remote);

    await preloadWhisperPipeline("Xenova/whisper-base");
    const result = await transcribeWithWhisper(
      makePcmBuffer([1000, -1000, 500]),
      "Xenova/whisper-base",
      "en",
      "ko",
    );

    expect(remote.preload).toHaveBeenCalledTimes(1);
    expect(remote.transcribe).toHaveBeenCalledTimes(1);
    expect(cpu.preload).not.toHaveBeenCalled();
    expect(cpu.transcribe).not.toHaveBeenCalled();
    expect(result.transcript).toBe("remote transcript");
  });

  it("falls back to cpu when renderer preload fails", async () => {
    const cpu = {
      preload: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => "cpu transcript"),
      dispose: vi.fn(),
    };
    const remote: WhisperRemoteRuntime = {
      isReady: () => true,
      preload: vi.fn(async () => {
        throw new Error("renderer load failed");
      }),
      transcribe: vi.fn(async () => "remote transcript"),
      dispose: vi.fn(),
    };

    __setWhisperCpuRuntimeForTest(cpu);
    setWhisperRemoteRuntime(remote);

    await preloadWhisperPipeline("Xenova/whisper-base");
    await transcribeWithWhisper(
      makePcmBuffer([1000, -1000, 500]),
      "Xenova/whisper-base",
      "en",
      "ko",
    );

    expect(cpu.preload).toHaveBeenCalledTimes(1);
    expect(cpu.transcribe).toHaveBeenCalledTimes(1);
    expect(remote.transcribe).not.toHaveBeenCalled();
  });

  it("keeps sticky cpu fallback until dispose, then retries renderer", async () => {
    const cpu = {
      preload: vi.fn(async () => undefined),
      transcribe: vi.fn(async () => "cpu transcript"),
      dispose: vi.fn(),
    };
    const remoteTranscribe = vi
      .fn()
      .mockRejectedValueOnce(new Error("renderer transcribe failed"))
      .mockResolvedValue("remote transcript");
    const remotePreload = vi
      .fn()
      .mockResolvedValue(undefined);
    const remote: WhisperRemoteRuntime = {
      isReady: () => true,
      preload: remotePreload,
      transcribe: remoteTranscribe,
      dispose: vi.fn(),
    };

    __setWhisperCpuRuntimeForTest(cpu);
    setWhisperRemoteRuntime(remote);

    await preloadWhisperPipeline("Xenova/whisper-base");
    await transcribeWithWhisper(
      makePcmBuffer([1000, -1000, 500]),
      "Xenova/whisper-base",
      "en",
      "ko",
    );
    await transcribeWithWhisper(
      makePcmBuffer([1000, -1000, 500]),
      "Xenova/whisper-base",
      "en",
      "ko",
    );

    expect(remoteTranscribe).toHaveBeenCalledTimes(1);
    expect(cpu.transcribe).toHaveBeenCalledTimes(2);

    disposeWhisperPipeline();
    await preloadWhisperPipeline("Xenova/whisper-base");
    expect(remotePreload).toHaveBeenCalledTimes(2);
  });
});
