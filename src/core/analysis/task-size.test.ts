import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LanguageModel } from "ai";
import { generateObject } from "ai";
import { classifyTaskSize } from "./task-size";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

const mockedGenerateObject = vi.mocked(generateObject);
const DUMMY_MODEL = {} as LanguageModel;

describe("classifyTaskSize", () => {
  beforeEach(() => {
    mockedGenerateObject.mockReset();
  });

  it("returns small when classifier is confident", async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        size: "small",
        confidence: 0.91,
        reason: "Single low-risk action",
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const result = await classifyTaskSize(DUMMY_MODEL, "Email the venue");
    expect(result.size).toBe("small");
    expect(result.confidence).toBe(0.91);
  });

  it("returns large when classifier says large", async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        size: "large",
        confidence: 0.84,
        reason: "Needs multi-step planning",
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const result = await classifyTaskSize(DUMMY_MODEL, "Plan the full migration rollout");
    expect(result.size).toBe("large");
    expect(result.confidence).toBe(0.84);
  });

  it("falls back to large on low confidence", async () => {
    mockedGenerateObject.mockResolvedValueOnce({
      object: {
        size: "small",
        confidence: 0.2,
        reason: "Maybe small",
      },
    } as Awaited<ReturnType<typeof generateObject>>);

    const result = await classifyTaskSize(DUMMY_MODEL, "Refactor auth and billing", 0.65);
    expect(result.size).toBe("large");
    expect(result.confidence).toBe(0);
  });

  it("falls back to large when classifier throws", async () => {
    mockedGenerateObject.mockRejectedValueOnce(new Error("provider unavailable"));

    const result = await classifyTaskSize(DUMMY_MODEL, "Book flight");
    expect(result.size).toBe("large");
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("Classifier error:");
  });
});
