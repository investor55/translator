import { describe, expect, it } from "vitest";
import { initialState, sessionStateReducer } from "./use-session";

describe("useSession reducer", () => {
  it("session-resumed sets active session and clears transient state", () => {
    const dirtyState = {
      ...initialState,
      summary: { keyPoints: ["old"], updatedAt: 1 },
      cost: 123,
      statusText: "stale status",
      errorText: "stale error",
    };

    const next = sessionStateReducer(dirtyState, {
      kind: "session-resumed",
      data: {
        sessionId: "s1",
        blocks: [],
        todos: [],
        insights: [],
        agents: [],
      },
    });

    expect(next.sessionActive).toBe(true);
    expect(next.sessionId).toBe("s1");
    expect(next.summary).toBeNull();
    expect(next.cost).toBe(0);
    expect(next.statusText).toBe("");
    expect(next.errorText).toBe("");
  });

  it("session-cleared resets all session state", () => {
    const dirtyState = {
      ...initialState,
      sessionId: "s1",
      sessionActive: true,
      blocks: [{
        id: 1,
        sourceLabel: "ko",
        sourceText: "test",
        targetLabel: "en",
        translation: "test",
        createdAt: Date.now(),
        audioSource: "system" as const,
      }],
      rollingKeyPoints: ["point"],
      statusText: "running",
      errorText: "error",
    };

    const next = sessionStateReducer(dirtyState, { kind: "session-cleared" });
    expect(next).toEqual(initialState);
  });
});
