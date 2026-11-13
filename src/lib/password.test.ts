import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, passwordProblems, passwordStrength } from "./password";

describe("password rules", () => {
  it("rejects short and common passwords", () => {
    expect(passwordProblems("short")).toHaveLength(1);
    expect(passwordProblems("password1")).not.toHaveLength(0);
    expect(passwordProblems("a".repeat(MIN_PASSWORD_LENGTH))).toHaveLength(0);
  });
  it("scores weak below the minimum, stronger with length and variety", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("abc").label).toBe("Weak");
    const fair = passwordStrength("abcdefghijk");
    const strong = passwordStrength("Correct-Horse-Battery-9");
    expect(strong.score).toBeGreaterThan(fair.score);
    expect(strong.label).toMatch(/Strong|Very strong/);
  });
});
