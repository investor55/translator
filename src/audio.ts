import { spawn } from "node:child_process";
import type { Device } from "./types";

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

function parseAvfoundationOutput(output: string): Device[] {
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

export function formatDevices(devices: Device[]) {
  if (devices.length === 0) {
    return "No avfoundation audio devices found.";
  }
  return devices.map((device) => `[${device.index}] ${device.name}`).join("\n");
}

export function spawnFfmpeg(deviceIndex: number) {
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
