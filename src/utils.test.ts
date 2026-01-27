import { describe, it, expect } from "vitest";
import {
  pcmToWavBuffer,
  normalizeText,
  cleanTranslationOutput,
  parseArgs,
  toReadableError,
} from "./utils";

describe("pcmToWavBuffer", () => {
  it("creates valid WAV header", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    expect(wav.length).toBe(44 + 100);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.toString("ascii", 36, 40)).toBe("data");
  });

  it("sets correct file size in header", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    const chunkSize = wav.readUInt32LE(4);
    expect(chunkSize).toBe(36 + 100);
  });

  it("sets correct sample rate", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    const sampleRate = wav.readUInt32LE(24);
    expect(sampleRate).toBe(16000);
  });

  it("sets mono channel", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    const numChannels = wav.readUInt16LE(22);
    expect(numChannels).toBe(1);
  });

  it("sets 16-bit sample depth", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    const bitsPerSample = wav.readUInt16LE(34);
    expect(bitsPerSample).toBe(16);
  });

  it("sets correct byte rate", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 16000);

    const byteRate = wav.readUInt32LE(28);
    expect(byteRate).toBe(16000 * 1 * 2);
  });

  it("copies PCM data after header", () => {
    const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const wav = pcmToWavBuffer(pcm, 16000);

    expect(wav[44]).toBe(0x01);
    expect(wav[45]).toBe(0x02);
    expect(wav[46]).toBe(0x03);
    expect(wav[47]).toBe(0x04);
  });

  it("handles different sample rates", () => {
    const pcm = Buffer.alloc(100);
    const wav = pcmToWavBuffer(pcm, 44100);

    const sampleRate = wav.readUInt32LE(24);
    expect(sampleRate).toBe(44100);
  });
});

describe("normalizeText", () => {
  it("trims whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeText("hello   world")).toBe("hello world");
  });

  it("handles tabs and newlines", () => {
    expect(normalizeText("hello\t\nworld")).toBe("hello world");
  });

  it("returns empty string for whitespace only", () => {
    expect(normalizeText("   ")).toBe("");
  });

  it("handles mixed whitespace", () => {
    expect(normalizeText("  hello \n\t world  ")).toBe("hello world");
  });
});

describe("cleanTranslationOutput", () => {
  it("returns first non-header line", () => {
    expect(cleanTranslationOutput("Hello world")).toBe("Hello world");
  });

  it("filters out markdown headers", () => {
    expect(cleanTranslationOutput("# Header\nActual content")).toBe(
      "Actual content"
    );
  });

  it("filters out Translation: prefix lines", () => {
    expect(cleanTranslationOutput("Translation:\nThe content")).toBe(
      "The content"
    );
  });

  it("filters out Explanation: prefix lines", () => {
    expect(cleanTranslationOutput("Explanation of the text\nActual")).toBe(
      "Actual"
    );
  });

  it("filters out Breakdown: prefix lines", () => {
    expect(cleanTranslationOutput("Breakdown of sentence\nResult")).toBe(
      "Result"
    );
  });

  it("removes leading dash", () => {
    expect(cleanTranslationOutput("- The translation")).toBe("The translation");
  });

  it("removes leading en-dash", () => {
    expect(cleanTranslationOutput("– The translation")).toBe("The translation");
  });

  it("removes leading em-dash", () => {
    expect(cleanTranslationOutput("— The translation")).toBe("The translation");
  });

  it("handles empty input", () => {
    expect(cleanTranslationOutput("")).toBe("");
  });

  it("handles whitespace only", () => {
    expect(cleanTranslationOutput("   \n   ")).toBe("");
  });

  it("falls back to first line if all lines are headers", () => {
    expect(cleanTranslationOutput("# Header\n## Another")).toBe("# Header");
  });
});

describe("parseArgs", () => {
  it("returns default config with no args", () => {
    const config = parseArgs([]);
    expect(config.direction).toBe("auto");
    expect(config.engine).toBe("elevenlabs");
    expect(config.listDevices).toBe(false);
    expect(config.help).toBe(false);
    expect(config.useContext).toBe(true);
    expect(config.compact).toBe(false);
  });

  it("parses --help flag", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("parses --list-devices flag", () => {
    const config = parseArgs(["--list-devices"]);
    expect(config.listDevices).toBe(true);
  });

  it("parses --device with space separator", () => {
    const config = parseArgs(["--device", "blackhole"]);
    expect(config.device).toBe("blackhole");
  });

  it("parses --device with equals separator", () => {
    const config = parseArgs(["--device=blackhole"]);
    expect(config.device).toBe("blackhole");
  });

  it("parses --direction", () => {
    expect(parseArgs(["--direction", "ko-en"]).direction).toBe("ko-en");
    expect(parseArgs(["--direction=en-ko"]).direction).toBe("en-ko");
    expect(parseArgs(["--direction", "auto"]).direction).toBe("auto");
  });

  it("ignores invalid direction values", () => {
    const config = parseArgs(["--direction", "invalid"]);
    expect(config.direction).toBe("auto");
  });

  it("parses --model", () => {
    const config = parseArgs(["--model", "custom-model"]);
    expect(config.modelId).toBe("custom-model");
  });

  it("parses --engine", () => {
    expect(parseArgs(["--engine", "vertex"]).engine).toBe("vertex");
    expect(parseArgs(["--engine=elevenlabs"]).engine).toBe("elevenlabs");
  });

  it("ignores invalid engine values", () => {
    const config = parseArgs(["--engine", "invalid"]);
    expect(config.engine).toBe("elevenlabs");
  });

  it("parses --vertex-model", () => {
    const config = parseArgs(["--vertex-model", "gemini-pro"]);
    expect(config.vertexModelId).toBe("gemini-pro");
  });

  it("parses --vertex-project", () => {
    const config = parseArgs(["--vertex-project", "my-project"]);
    expect(config.vertexProject).toBe("my-project");
  });

  it("parses --vertex-location", () => {
    const config = parseArgs(["--vertex-location", "europe-west1"]);
    expect(config.vertexLocation).toBe("europe-west1");
  });

  it("parses --context-file", () => {
    const config = parseArgs(["--context-file", "custom.md"]);
    expect(config.contextFile).toBe("custom.md");
  });

  it("parses --no-context", () => {
    const config = parseArgs(["--no-context"]);
    expect(config.useContext).toBe(false);
  });

  it("parses --compact", () => {
    const config = parseArgs(["--compact"]);
    expect(config.compact).toBe(true);
  });

  it("parses multiple flags together", () => {
    const config = parseArgs([
      "--engine",
      "vertex",
      "--direction",
      "ko-en",
      "--compact",
      "--no-context",
    ]);
    expect(config.engine).toBe("vertex");
    expect(config.direction).toBe("ko-en");
    expect(config.compact).toBe(true);
    expect(config.useContext).toBe(false);
  });
});

describe("toReadableError", () => {
  it("extracts message from Error", () => {
    const error = new Error("Something went wrong");
    expect(toReadableError(error)).toBe("Something went wrong");
  });

  it("converts string to string", () => {
    expect(toReadableError("Plain string error")).toBe("Plain string error");
  });

  it("converts number to string", () => {
    expect(toReadableError(404)).toBe("404");
  });

  it("converts null to string", () => {
    expect(toReadableError(null)).toBe("null");
  });

  it("converts undefined to string", () => {
    expect(toReadableError(undefined)).toBe("undefined");
  });

  it("converts object to string", () => {
    expect(toReadableError({ code: "ERR" })).toBe("[object Object]");
  });
});
