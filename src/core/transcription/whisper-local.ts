import { ChildProcess, fork } from "node:child_process";
import path from "node:path";
import type { LanguageCode } from "../types";
import { detectSourceLanguage } from "../language";
import { log } from "../logger";

export function pcmToFloat32(pcmBuffer: Buffer): Float32Array {
  const samples = pcmBuffer.length / 2;
  const float32 = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    float32[i] = pcmBuffer.readInt16LE(i * 2) / 32768.0;
  }
  return float32;
}

type PendingCall = { resolve: (value: unknown) => void; reject: (reason: Error) => void };
type PendingMeta = {
  type: string;
  modelId?: string;
  startedAt: number;
  samples?: number;
};

type WhisperChildResponse = {
  id: number;
  type: "loaded" | "result" | "disposed" | "error";
  text?: string;
  message?: string;
};

type WhisperChildRequest = {
  type: "load" | "transcribe" | "dispose";
  modelId?: string;
  audio?: Float32Array;
  languageHints?: string[];
};

type WhisperRuntimePath = "renderer-webgpu" | "cpu-child";

type WhisperCpuRuntime = {
  preload: (modelId: string) => Promise<void>;
  transcribe: (
    audio: Float32Array,
    modelId: string,
    languageHints: string[],
  ) => Promise<string>;
  dispose: () => void;
};

export type WhisperRemoteRuntime = {
  isReady: () => boolean;
  preload: (modelId: string) => Promise<void>;
  transcribe: (
    audio: Float32Array,
    modelId: string,
    languageHints: string[],
  ) => Promise<string>;
  dispose: () => Promise<void> | void;
};

let child: ChildProcess | null = null;
let nextId = 0;
const pending = new Map<number, PendingCall>();
const pendingMeta = new Map<number, PendingMeta>();
let terminatingChildPid: number | null = null;
let remoteRuntime: WhisperRemoteRuntime | null = null;
let cpuRuntime: WhisperCpuRuntime;
let forceCpuFallbackForSession = false;
let activeRuntimePath: WhisperRuntimePath | null = null;

function formatMemUsage(): string {
  const mem = process.memoryUsage();
  const toMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  return `rss=${toMb(mem.rss)}MB heap=${toMb(mem.heapUsed)}/${toMb(mem.heapTotal)}MB ext=${toMb(mem.external)}MB`;
}

function rejectAllPending(error: Error): void {
  for (const [id, p] of pending) {
    pending.delete(id);
    pendingMeta.delete(id);
    p.reject(error);
  }
}

function spawnChild(): ChildProcess {
  // In the CJS bundle at .vite/build/main.js, __dirname is .vite/build/
  // whisper-child.js is built to the same directory.
  const childPath = path.join(__dirname, "whisper-child.js");
  const c = fork(childPath, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    serialization: "advanced",
  });

  log("INFO", `Spawning Whisper child process: path=${childPath}`);
  terminatingChildPid = null;

  c.on("spawn", () => {
    log("INFO", `Whisper child spawned: pid=${c.pid ?? -1}`);
  });

  c.on("disconnect", () => {
    log("WARN", `Whisper child IPC disconnected: pid=${c.pid ?? -1}, pending=${pending.size}`);
  });

  c.on("message", (msg: WhisperChildResponse) => {
    const p = pending.get(msg.id);
    const meta = pendingMeta.get(msg.id);
    if (!p) return;

    pending.delete(msg.id);
    pendingMeta.delete(msg.id);

    const elapsedMs = meta ? Date.now() - meta.startedAt : -1;
    const elapsed = elapsedMs >= 0 ? `${elapsedMs}ms` : "unknown";

    if (msg.type === "error") {
      log(
        "ERROR",
        `Whisper child request failed: id=${msg.id} op=${meta?.type ?? "unknown"} model=${meta?.modelId ?? "-"} elapsed=${elapsed} message=${msg.message ?? "Worker error"}`
      );
      p.reject(new Error(msg.message ?? "Worker error"));
      return;
    }

    if (meta?.type === "load") {
      log(
        "INFO",
        `Whisper child load done: id=${msg.id} model=${meta.modelId ?? "-"} elapsed=${elapsed}`
      );
    } else if (meta?.type === "transcribe") {
      const samples = meta.samples ?? 0;
      const durationMs = (samples / 16000) * 1000;
      const textLen = (msg.text ?? "").trim().length;
      log(
        "INFO",
        `Whisper child transcribe done: id=${msg.id} model=${meta.modelId ?? "-"} audio=${durationMs.toFixed(0)}ms samples=${samples} textLen=${textLen} elapsed=${elapsed}`
      );
    }

    p.resolve(msg);
  });

  c.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) log("INFO", `Whisper child: ${line}`);
  });

  c.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (!line) return;
    const intentionalTeardown = terminatingChildPid !== null && c.pid === terminatingChildPid;
    const knownTeardownNoise =
      line.includes("mutex lock failed: Invalid argument") ||
      line.includes("terminating due to uncaught exception of type std::__1::system_error");
    if (intentionalTeardown && knownTeardownNoise) {
      log("INFO", `Whisper child teardown note: ${line}`);
      return;
    }
    log("WARN", `Whisper child stderr: ${line}`);
  });

  c.on("error", (err: Error) => {
    log("ERROR", `Whisper child error: ${err.message} | pending=${pending.size} | ${formatMemUsage()}`);
    rejectAllPending(err);
    child = null;
  });

  c.on("exit", (code, signal) => {
    const expectedExit = code === 0 || signal === "SIGTERM" || signal === "SIGINT";
    const intentionalShutdown = terminatingChildPid !== null && c.pid === terminatingChildPid && pending.size === 0;
    if (!expectedExit && !intentionalShutdown) {
      log(
        "ERROR",
        `Whisper child exited unexpectedly: code=${code} signal=${signal ?? "none"} pending=${pending.size} ${formatMemUsage()}`
      );
      rejectAllPending(new Error(`Whisper process exited unexpectedly (code=${code}, signal=${signal ?? "none"})`));
    } else {
      log("INFO", `Whisper child exited: code=${code} signal=${signal ?? "none"} intentional=${intentionalShutdown}`);
    }
    if (intentionalShutdown) terminatingChildPid = null;
    child = null;
  });

  return c;
}

function getChild(): ChildProcess {
  if (!child || child.killed || !child.connected) {
    if (child && (child.killed || !child.connected)) {
      log("WARN", `Whisper child unavailable; respawning (killed=${child.killed}, connected=${child.connected})`);
    }
    child = spawnChild();
  }
  return child;
}

function callChild<T>(msg: WhisperChildRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const samples = msg.type === "transcribe" ? msg.audio?.length : undefined;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    pendingMeta.set(id, {
      type: msg.type,
      modelId: msg.modelId,
      startedAt: Date.now(),
      samples,
    });

    if (msg.type === "load") {
      log("INFO", `Whisper child load start: id=${id} model=${msg.modelId ?? "-"}`);
    } else if (msg.type === "transcribe") {
      const durationMs = ((samples ?? 0) / 16000) * 1000;
      log(
        "INFO",
        `Whisper child transcribe start: id=${id} model=${msg.modelId ?? "-"} audio=${durationMs.toFixed(0)}ms samples=${samples ?? 0} hints=${(msg.languageHints ?? []).join(",") || "-"}`
      );
    }

    const c = getChild();
    c.send({ ...msg, id }, (err) => {
      if (!err) return;
      const pendingCall = pending.get(id);
      if (!pendingCall) return;
      pending.delete(id);
      pendingMeta.delete(id);
      pendingCall.reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

const defaultCpuRuntime: WhisperCpuRuntime = {
  async preload(modelId: string): Promise<void> {
    log("INFO", `Loading Whisper model in isolated process: ${modelId}`);
    await callChild<{ type: "loaded" }>({ type: "load", modelId });
    log("INFO", `Whisper model ready (path=cpu-child): ${modelId}`);
  },
  async transcribe(
    audio: Float32Array,
    modelId: string,
    languageHints: string[],
  ): Promise<string> {
    const result = await callChild<{ type: "result"; text: string }>({
      type: "transcribe",
      modelId,
      audio,
      languageHints,
    });
    return result.text.trim();
  },
  dispose(): void {
    if (child) {
      log("INFO", `Disposing Whisper child process: pid=${child.pid ?? -1}`);
      terminatingChildPid = child.pid ?? null;
      child.kill("SIGTERM");
      child = null;
    }
    rejectAllPending(new Error("Whisper process disposed"));
  },
};

cpuRuntime = defaultCpuRuntime;

function preferredRuntimePath(): WhisperRuntimePath {
  if (activeRuntimePath === "cpu-child") return "cpu-child";
  if (forceCpuFallbackForSession) return "cpu-child";
  if (activeRuntimePath === "renderer-webgpu") return "renderer-webgpu";
  if (remoteRuntime?.isReady()) return "renderer-webgpu";
  return "cpu-child";
}

function markCpuFallback(reason: string): void {
  if (!forceCpuFallbackForSession) {
    log("WARN", `Whisper runtime fallback engaged (renderer-webgpu -> cpu-child): ${reason}`);
  }
  forceCpuFallbackForSession = true;
  activeRuntimePath = "cpu-child";
}

function chooseLanguageHints(sourceLang: LanguageCode, targetLang: LanguageCode): string[] {
  return Array.from(new Set([sourceLang, targetLang]));
}

function isSuspiciousWhisperTranscript(transcript: string): boolean {
  const text = transcript.trim();
  if (!text) return false;

  const tokens = text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);

  const symbolOnly = text.replace(/[\s>]/g, "");
  const isMostlyAngles = text.length >= 24 && symbolOnly.length <= 2 && />{8,}/.test(text.replace(/\s/g, ""));
  if (isMostlyAngles) return true;

  if (tokens.length < 10) return false;

  let longestRun = 1;
  let currentRun = 1;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 1]) {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 1;
    }
  }
  if (longestRun >= 8) return true;

  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const topCount = Math.max(...counts.values());
  return topCount / tokens.length >= 0.55;
}

export function setWhisperRemoteRuntime(runtime: WhisperRemoteRuntime | null): void {
  remoteRuntime = runtime;
}

// Test hooks for runtime routing without spawning real inference processes.
export function __setWhisperCpuRuntimeForTest(runtime: WhisperCpuRuntime): void {
  cpuRuntime = runtime;
}

export function __resetWhisperRuntimeStateForTest(): void {
  try {
    cpuRuntime.dispose();
  } catch {
    // no-op in tests
  }
  remoteRuntime = null;
  cpuRuntime = defaultCpuRuntime;
  forceCpuFallbackForSession = false;
  activeRuntimePath = null;
}

export async function preloadWhisperPipeline(modelId: string): Promise<void> {
  const path = preferredRuntimePath();
  if (path === "renderer-webgpu" && remoteRuntime) {
    try {
      log("INFO", `Loading Whisper model in renderer (path=renderer-webgpu): ${modelId}`);
      await remoteRuntime.preload(modelId);
      activeRuntimePath = "renderer-webgpu";
      log("INFO", `Whisper model ready (path=renderer-webgpu): ${modelId}`);
      return;
    } catch (error) {
      markCpuFallback(error instanceof Error ? error.message : String(error));
    }
  }

  await cpuRuntime.preload(modelId);
  activeRuntimePath = "cpu-child";
}

export function disposeWhisperPipeline(): void {
  if (remoteRuntime) {
    void Promise.resolve(remoteRuntime.dispose()).catch((error) => {
      log(
        "WARN",
        `Whisper renderer dispose failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
  cpuRuntime.dispose();
  forceCpuFallbackForSession = false;
  activeRuntimePath = null;
}

export type WhisperResult = { transcript: string; detectedLang: LanguageCode };

export async function transcribeWithWhisper(
  pcmBuffer: Buffer,
  modelId: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
): Promise<WhisperResult> {
  const float32 = pcmToFloat32(pcmBuffer);
  const languageHints = chooseLanguageHints(sourceLang, targetLang);
  let transcript = "";
  const path = preferredRuntimePath();

  if (path === "renderer-webgpu" && remoteRuntime) {
    try {
      transcript = (await remoteRuntime.transcribe(float32, modelId, languageHints)).trim();
      if (isSuspiciousWhisperTranscript(transcript)) {
        markCpuFallback("suspicious repeating/symbol transcript from renderer-webgpu");
        transcript = await cpuRuntime.transcribe(float32, modelId, languageHints);
        transcript = transcript.trim();
        activeRuntimePath = "cpu-child";
        log("INFO", "Whisper transcription complete (path=cpu-child, auto-fallback-on-quality)");
      } else {
        activeRuntimePath = "renderer-webgpu";
        log("INFO", "Whisper transcription complete (path=renderer-webgpu)");
      }
    } catch (error) {
      markCpuFallback(error instanceof Error ? error.message : String(error));
      transcript = await cpuRuntime.transcribe(float32, modelId, languageHints);
      transcript = transcript.trim();
      activeRuntimePath = "cpu-child";
      log("INFO", "Whisper transcription complete (path=cpu-child)");
    }
  } else {
    transcript = await cpuRuntime.transcribe(float32, modelId, languageHints);
    transcript = transcript.trim();
    activeRuntimePath = "cpu-child";
    log("INFO", "Whisper transcription complete (path=cpu-child)");
  }

  const detectedLang = detectSourceLanguage(transcript, sourceLang, targetLang);
  return { transcript, detectedLang };
}
