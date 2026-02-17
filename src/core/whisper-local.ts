import { ChildProcess, fork } from "node:child_process";
import path from "node:path";
import type { LanguageCode } from "./types";
import { detectSourceLanguage } from "./language";
import { log } from "./logger";

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

let child: ChildProcess | null = null;
let nextId = 0;
const pending = new Map<number, PendingCall>();
const pendingMeta = new Map<number, PendingMeta>();
let terminatingChildPid: number | null = null;

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

export async function preloadWhisperPipeline(modelId: string): Promise<void> {
  log("INFO", `Loading Whisper model in isolated process: ${modelId}`);
  await callChild<{ type: "loaded" }>({ type: "load", modelId });
  log("INFO", `Whisper model ready: ${modelId}`);
}

export function disposeWhisperPipeline(): void {
  if (child) {
    log("INFO", `Disposing Whisper child process: pid=${child.pid ?? -1}`);
    terminatingChildPid = child.pid ?? null;
    child.kill("SIGTERM");
    child = null;
  }
  rejectAllPending(new Error("Whisper process disposed"));
}

export type WhisperResult = { transcript: string; detectedLang: LanguageCode };

export async function transcribeWithWhisper(
  pcmBuffer: Buffer,
  modelId: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
): Promise<WhisperResult> {
  const float32 = pcmToFloat32(pcmBuffer);
  const result = await callChild<{ type: "result"; text: string }>({
    type: "transcribe",
    modelId,
    audio: float32,
    languageHints: Array.from(new Set([sourceLang, targetLang])),
  });
  const transcript = result.text.trim();
  const detectedLang = detectSourceLanguage(transcript, sourceLang, targetLang);
  return { transcript, detectedLang };
}
