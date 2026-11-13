import { describe, expect, it } from "vitest";
import { baselineDailySpend, daysOfCover, forecast } from "./forecast";

const base = { today: "2026-11-13", days: 30, startBalance: 100_000, events: [], dailySpend: 1_000 };

describe("forecast", () => {
  it("with nothing scheduled the balance falls by the daily spend each day", () => {
    const r = forecast(base);
    expect(r.points).toHaveLength(31);
    expect(r.points[0]).toEqual({ date: "2026-11-13", balance: 100_000 });
    expect(r.endBalance).toBe(100_000 - 30 * 1_000);
    expect(r.variableSpend).toBe(30_000);
    expect(r.lowest.date).toBe("2026-12-13");
  });

  it("adds scheduled income and subtracts scheduled bills on their dates", () => {
    const r = forecast({
      ...base,
      dailySpend: 0,
      events: [
        { date: "2026-11-20", amount: -20_000, label: "Rent", nature: "scheduled" },
        { date: "2026-11-25", amount: 65_000, label: "Salary", nature: "scheduled" },
      ],
    });
    expect(r.points.find((p) => p.date === "2026-11-19")!.balance).toBe(100_000);
    expect(r.points.find((p) => p.date === "2026-11-20")!.balance).toBe(80_000);
    expect(r.points.find((p) => p.date === "2026-11-25")!.balance).toBe(145_000);
    expect(r.endBalance).toBe(145_000);
    expect(r).toMatchObject({ scheduledIn: 65_000, scheduledOut: 20_000 });
  });

  it("an overdue item is expected on the next day, not silently dropped", () => {
    const r = forecast({ ...base, dailySpend: 0, events: [{ date: "2026-11-01", amount: -5_000, label: "Overdue rent", nature: "scheduled" }] });
    expect(r.points.find((p) => p.date === "2026-11-14")!.balance).toBe(95_000);
  });

  it("ignores events beyond the horizon", () => {
    const r = forecast({ ...base, dailySpend: 0, events: [{ date: "2027-03-01", amount: -50_000, label: "Far", nature: "scheduled" }] });
    expect(r.endBalance).toBe(100_000);
    expect(r.scheduledOut).toBe(0);
  });

  it("finds the lowest point and the first day the balance goes negative", () => {
    const r = forecast({ ...base, startBalance: 5_000, dailySpend: 1_000, events: [{ date: "2026-11-20", amount: 30_000, label: "Pay", nature: "scheduled" }] });
    expect(r.firstNegative).toBe("2026-11-19"); // 5,000 - 6 days * 1,000 = -1,000
    expect(r.lowest.balance).toBeLessThan(0);
  });

  it("a negative start is reported as negative from today", () => {
    expect(forecast({ ...base, startBalance: -1 }).firstNegative).toBe("2026-11-13");
  });

  it("what-if: changing everyday spending by a percentage and adding one-offs", () => {
    const cut = forecast({ ...base, spendChangePct: -50 });
    expect(cut.dailyVariable).toBe(500);
    expect(cut.endBalance).toBe(100_000 - 15_000);
    const raise = forecast({ ...base, spendChangePct: 25 });
    expect(raise.dailyVariable).toBe(1_250);
    const oneOff = forecast({ ...base, dailySpend: 0, oneOffs: [{ date: "2026-11-30", amount: -40_000 }] });
    expect(oneOff.endBalance).toBe(60_000);
    expect(forecast({ ...base, spendChangePct: -500 }).dailyVariable).toBe(0); // never negative spending
  });

  it("uses exact integer arithmetic (no float drift)", () => {
    const r = forecast({ ...base, dailySpend: 333, days: 90 });
    expect(Number.isInteger(r.endBalance)).toBe(true);
    expect(r.endBalance).toBe(100_000 - 90 * 333);
  });
});

describe("baselineDailySpend", () => {
  it("excludes recurring spending, which is projected separately", () => {
    const r = baselineDailySpend({ spendTotal: 100_000, recurringSettledTotal: 40_000, historyDays: 60 });
    expect(r.perDay).toBe(1_000);
    expect(r.confidence).toBe("high");
  });
  it("labels short histories as low or medium confidence", () => {
    expect(baselineDailySpend({ spendTotal: 10_000, recurringSettledTotal: 0, historyDays: 5 }).confidence).toBe("low");
    expect(baselineDailySpend({ spendTotal: 10_000, recurringSettledTotal: 0, historyDays: 30 }).confidence).toBe("medium");
  });
  it("never goes negative and never divides by zero", () => {
    expect(baselineDailySpend({ spendTotal: 10, recurringSettledTotal: 50, historyDays: 0 })).toMatchObject({ perDay: 0, basisDays: 1 });
  });
});

describe("daysOfCover", () => {
  it("is how many whole days the balance lasts at the steady spend", () => {
    expect(daysOfCover(10_000, 1_000)).toBe(10);
    expect(daysOfCover(10_500, 1_000)).toBe(10);
    expect(daysOfCover(10_000, 0)).toBeNull();
    expect(daysOfCover(0, 1_000)).toBe(0);
  });
});
