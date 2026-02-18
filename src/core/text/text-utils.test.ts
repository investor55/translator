import { describe, expect, it } from "vitest";
import { isLikelyDuplicateTodoText, normalizeTodoText } from "./text-utils";

describe("normalizeTodoText", () => {
  it("normalizes whitespace, case, and punctuation", () => {
    expect(normalizeTodoText("  Find places on Victoria Drive still open at 8 PM!  ")).toBe(
      "find places on victoria drive still open at 8 pm"
    );
  });
});

describe("isLikelyDuplicateTodoText", () => {
  it("matches equivalent todos with minor wording differences", () => {
    const a = "Find pho restaurants in Vancouver open past 9 PM";
    const b = "Find a pho restaurant in Vancouver that is open after 9pm";
    expect(isLikelyDuplicateTodoText(a, b)).toBe(true);
  });

  it("matches punctuation and case variants", () => {
    expect(isLikelyDuplicateTodoText("Call Alex about taxes", "call alex about taxes.")).toBe(true);
  });

  it("does not treat unrelated todos as duplicates", () => {
    const a = "Book a dentist appointment for next week";
    const b = "Compare internet providers in Seattle";
    expect(isLikelyDuplicateTodoText(a, b)).toBe(false);
  });
});
