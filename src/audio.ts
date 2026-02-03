import { spawn, type ChildProcess } from "node:child_process";
import { AudioTee } from "audiotee";
import { release } from "node:os";
import type { Device } from "./types";

// ============================================================================
// ScreenCaptureKit-based Audio Capture (macOS 14.2+)
// ============================================================================

const MIN_DARWIN_VERSION = 23; // macOS 14 Sonoma = Darwin 23.x

export function checkMacOSVersion(): { supported: boolean; version: string } {
  const darwinVersion = parseInt(release().split(".")[0]);
  const supported = darwinVersion >= MIN_DARWIN_VERSION;
  // Map Darwin version to macOS version (approximate)
  const macOSVersion =
    darwinVersion >= 25
      ? "15+"
      : darwinVersion >= 24
        ? "15"
        : darwinVersion >= 23
          ? "14"
          : darwinVersion >= 22
            ? "13"
            : "12 or earlier";
  return { supported, version: macOSVersion };
}

export type AudioRecorder = {
  start: () => Promise<void>;
  stop: () => void;
  on: (event: "data" | "error", handler: (data: Buffer | Error) => void) => void;
};

export function createAudioRecorder(sampleRate = 16000): AudioRecorder {
  const audiotee = new AudioTee({
    sampleRate,
    chunkDuration: 0.1, // 100ms chunks for low latency
  });

  return {
    start: () => audiotee.start(),
    stop: () => audiotee.stop(),
    on: (event, handler) => {
      if (event === "data") {
        audiotee.on("data", ({ data }) => handler(data));
      } else if (event === "error") {
        audiotee.on("error", (err) => handler(err));
      }
    },
  };
}

// ============================================================================
// Legacy AVFoundation/ffmpeg Audio Capture (deprecated)
// Kept for --legacy-audio fallback mode
// ============================================================================

/** @deprecated Use createAudioRecorder() with ScreenCaptureKit instead */
export async function listAvfoundationDevices(): Promise<Device[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      ["-f", "avfoundation", "-list_devices", "true", "-i", ""],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      output += data.toString();
    });
    proc.on("error", (error) => {
      reject(error);
    });
    proc.on("close", () => {
      resolve(parseAvfoundationOutput(output));
    });
  });
}

/** @deprecated Use createAudioRecorder() with ScreenCaptureKit instead */
export function parseAvfoundationOutput(output: string): Device[] {
  const lines = output.split("\n");
  const devices: Device[] = [];
  let inAudioSection = false;

  for (const line of lines) {
    if (line.includes("AVFoundation audio devices")) {
      inAudioSection = true;
      continue;
    }
    if (line.includes("AVFoundation video devices")) {
      inAudioSection = false;
      continue;
    }
    if (!inAudioSection) {
      continue;
    }

    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (match) {
      devices.push({ index: Number(match[1]), name: match[2].trim() });
    }
  }

  return devices;
}

/** @deprecated Use createAudioRecorder() with ScreenCaptureKit instead */
export function selectAudioDevice(
  devices: Device[],
  override?: string
): Device | null {
  if (override) {
    if (/^\d+$/.test(override)) {
      const index = Number(override);
      return devices.find((device) => device.index === index) ?? null;
    }

    const lowered = override.toLowerCase();
    return (
      devices.find((device) => device.name.toLowerCase().includes(lowered)) ??
      null
    );
  }

  const matchers = [
    "blackhole",
    "loopback",
    "soundflower",
    "vb-cable",
    "ishowu",
  ];

  return (
    devices.find((device) =>
      matchers.some((matcher) => device.name.toLowerCase().includes(matcher))
    ) ?? null
  );
}

/** @deprecated Use createAudioRecorder() with ScreenCaptureKit instead */
export function formatDevices(devices: Device[]) {
  if (devices.length === 0) {
    return "No avfoundation audio devices found.";
  }
  return devices.map((device) => `[${device.index}] ${device.name}`).join("\n");
}

/** @deprecated Use createAudioRecorder() with ScreenCaptureKit instead */
export function spawnFfmpeg(deviceIndex: number): ChildProcess {
  const args = [
    "-f",
    "avfoundation",
    "-i",
    `:${deviceIndex}`,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "s16le",
    "-loglevel",
    "error",
    "-nostdin",
    "-",
  ];
  return spawn("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
}
