import { describe, expect, it } from "vitest";
import { trialCountdown } from "./trial-status";

const NOW = new Date("2026-11-22T10:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const H = 3_600_000;

describe("trial countdown wording", () => {
  it("counts whole days, rounding up, with a singular", () => {
    expect(trialCountdown(at(5 * 24 * H), NOW).label).toBe("Ends in 5 days");
    expect(trialCountdown(at(4.2 * 24 * H), NOW).label).toBe("Ends in 5 days");
    expect(trialCountdown(at(1.5 * 24 * H), NOW).label).toBe("Ends in 2 days");
    expect(trialCountdown(at(24 * H), NOW).label).toBe("Ends in 1 day");
  });
  it("switches to hours in the last day, and to a plain phrase in the last hour", () => {
    expect(trialCountdown(at(5 * H), NOW).label).toBe("Ends in 5 hours");
    expect(trialCountdown(at(0.5 * H + 1), NOW).label).toBe("Ends within the hour");
    expect(trialCountdown(at(H + 1), NOW).label).toBe("Ends in 2 hours");
  });
  it("says Ended once the date has passed, and tolerates a bad date", () => {
    expect(trialCountdown(at(-1), NOW).label).toBe("Ended");
    expect(trialCountdown(at(0), NOW).label).toBe("Ended");
    expect(trialCountdown("nonsense", NOW).label).toBe("Ended");
  });
});
