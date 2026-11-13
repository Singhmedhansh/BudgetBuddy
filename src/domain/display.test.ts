import { describe, expect, it } from "vitest";
import { displayAmount } from "./display";

describe("displayAmount", () => {
  it("shows spending as negative and income as positive", () => {
    expect(displayAmount({ type: "expense", amount: 1842_50 })).toBe(-184250);
    expect(displayAmount({ type: "income", amount: 6_500_000 })).toBe(6_500_000);
    expect(displayAmount({ type: "refund", amount: 500 })).toBe(500);
  });
  it("shows a reversal as the opposite of its original (regression: reversed expense looked like a second expense)", () => {
    expect(displayAmount({ type: "expense", amount: 184250, isReversal: true })).toBe(184250);
    expect(displayAmount({ type: "income", amount: 100, isReversal: true })).toBe(-100);
  });
  it("leaves transfers unsigned", () => {
    expect(displayAmount({ type: "transfer", amount: 1000 })).toBe(1000);
    expect(displayAmount({ type: "adjustment", amount: 1000 })).toBe(1000);
  });
});
