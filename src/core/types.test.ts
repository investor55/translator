import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHISPER_MODEL_ID,
  normalizeAppConfig,
} from "./types";

describe("Whisper model defaults", () => {
  it("uses whisper-small as the default local Whisper model", () => {
    expect(DEFAULT_WHISPER_MODEL_ID).toBe("Xenova/whisper-small");
  });

  it("preserves explicit whisper-small model IDs", () => {
    const config = normalizeAppConfig({
      transcriptionProvider: "whisper",
      transcriptionModelId: "Xenova/whisper-small",
    });
    expect(config.transcriptionModelId).toBe("Xenova/whisper-small");
  });
});
