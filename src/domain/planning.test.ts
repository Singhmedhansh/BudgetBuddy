import { describe, expect, it } from "vitest";
import { simulatePayoff, monthlyInterest, type Debt } from "./debt";
import { completionEstimate, goalHealth, goalProgress, monthlyTarget, monthsUntil } from "./goals";
import { addDays, dueState, monthlyEquivalent, nextDue, occurrencesBetween, parseDate, yearlyEquivalent } from "./recurrence";

describe("recurrence", () => {
  it("monthly on the 31st lands on the last day of shorter months and returns to the 31st", () => {
    const s = { frequency: "monthly" as const, firstDue: "2026-01-31" };
    expect(occurrencesBetween(s, "2026-01-01", "2026-05-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });
  it("handles leap years", () => {
    const s = { frequency: "monthly" as const, firstDue: "2028-01-31" };
    expect(occurrencesBetween(s, "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
    expect(occurrencesBetween({ frequency: "yearly", firstDue: "2028-02-29" }, "2028-01-01", "2032-12-31")).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });
  it("weekly, quarterly and once", () => {
    expect(occurrencesBetween({ frequency: "weekly", firstDue: "2026-11-02" }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(occurrencesBetween({ frequency: "quarterly", firstDue: "2026-01-15" }, "2026-01-01", "2026-12-31")).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
    expect(occurrencesBetween({ frequency: "once", firstDue: "2026-11-20" }, "2026-01-01", "2026-12-31")).toEqual(["2026-11-20"]);
    expect(occurrencesBetween({ frequency: "once", firstDue: "2026-11-20" }, "2026-12-01", "2026-12-31")).toEqual([]);
  });
  it("respects the end date and range bounds (inclusive)", () => {
    const s = { frequency: "monthly" as const, firstDue: "2026-01-10", endsOn: "2026-03-10" };
    expect(occurrencesBetween(s, "2026-01-01", "2026-12-31")).toEqual(["2026-01-10", "2026-02-10", "2026-03-10"]);
    expect(occurrencesBetween({ frequency: "monthly", firstDue: "2026-01-10" }, "2026-02-10", "2026-02-10")).toEqual(["2026-02-10"]);
    expect(occurrencesBetween({ frequency: "monthly", firstDue: "2026-01-10" }, "2026-03-01", "2026-02-01")).toEqual([]);
  });
  it("nextDue finds the next occurrence or null when finished", () => {
    const s = { frequency: "monthly" as const, firstDue: "2026-01-31", endsOn: "2026-06-30" };
    expect(nextDue(s, "2026-02-01")).toBe("2026-02-28");
    expect(nextDue(s, "2026-06-30")).toBe("2026-06-30");
    expect(nextDue(s, "2026-07-01")).toBeNull();
  });
  it("normalises cost to monthly and yearly", () => {
    expect(monthlyEquivalent(120_000, "yearly")).toBe(10_000);
    expect(monthlyEquivalent(10_000, "weekly")).toBe(43_333);
    expect(yearlyEquivalent(14_900, "monthly")).toBe(178_800);
    expect(monthlyEquivalent(5_000, "once")).toBe(0);
  });
  it("rejects invalid dates", () => {
    expect(() => parseDate("2026-02-30")).toThrow();
    expect(() => parseDate("2026-13-01")).toThrow();
    expect(() => parseDate("nope")).toThrow();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("dueState: paid wins, then overdue, due soon, upcoming", () => {
    expect(dueState("2026-11-01", "2026-11-13", true, 3)).toBe("paid");
    expect(dueState("2026-11-01", "2026-11-13", false, 3)).toBe("overdue");
    expect(dueState("2026-11-13", "2026-11-13", false, 3)).toBe("due_soon");
    expect(dueState("2026-11-16", "2026-11-13", false, 3)).toBe("due_soon");
    expect(dueState("2026-11-17", "2026-11-13", false, 3)).toBe("upcoming");
  });
});

describe("savings goals", () => {
  const today = "2026-11-13";
  it("progress is capped and never negative", () => {
    expect(goalProgress({ target: 100_000, saved: 25_000 })).toMatchObject({ remaining: 75_000, ratio: 0.25, complete: false });
    expect(goalProgress({ target: 100_000, saved: 150_000 })).toMatchObject({ remaining: 0, ratio: 1, complete: true });
    expect(goalProgress({ target: 100_000, saved: -5_000 }).saved).toBe(0);
  });
  it("monthsUntil counts a partial month as one", () => {
    expect(monthsUntil("2026-12-13", today)).toBe(1);
    expect(monthsUntil("2026-12-14", today)).toBe(2);
    expect(monthsUntil("2027-11-13", today)).toBe(12);
    expect(monthsUntil("2026-11-14", today)).toBe(1);
    expect(monthsUntil("2026-01-01", today)).toBe(0);
  });
  it("monthly target rounds up so the goal is reached by the deadline", () => {
    expect(monthlyTarget({ target: 100_000, saved: 0, deadline: "2027-11-13", today })).toBe(8_334); // 100000/12 rounded up
    expect(monthlyTarget({ target: 100_000, saved: 100_000, deadline: "2027-11-13", today })).toBe(0);
    expect(monthlyTarget({ target: 100_000, saved: 40_000, deadline: "2026-11-01", today })).toBe(60_000); // past due
    expect(monthlyTarget({ target: 100_000, saved: 0, today })).toBeNull();
  });
  it("completion estimate uses recent pace and is null without one", () => {
    const contributions = [{ date: "2026-10-20", amount: 9_000 }, { date: "2026-11-05", amount: 9_000 }];
    const est = completionEstimate({ target: 100_000, saved: 18_000, contributions, today });
    expect(est).toBeTruthy();
    expect(est! > today).toBe(true);
    expect(completionEstimate({ target: 100_000, saved: 18_000, contributions: [], today })).toBeNull();
    expect(completionEstimate({ target: 100_000, saved: 100_000, contributions, today })).toBe(today);
    expect(completionEstimate({ target: 100_000, saved: 0, contributions: [{ date: "2020-01-01", amount: 1000 }], today })).toBeNull();
  });
  it("health: complete, on track, behind, no deadline", () => {
    const g = { target: 100_000, saved: 50_000, deadline: "2027-06-01", today };
    expect(goalHealth({ ...g, saved: 100_000 }, null)).toBe("complete");
    expect(goalHealth(g, "2027-03-01")).toBe("on_track");
    expect(goalHealth(g, "2027-09-01")).toBe("behind");
    expect(goalHealth(g, null)).toBe("behind");
    expect(goalHealth({ ...g, deadline: null }, null)).toBe("no_deadline");
  });
});

describe("debt payoff", () => {
  const card: Debt = { id: "card", name: "Card", balance: 100_000, rateBps: 3600, minPayment: 3_000 }; // 36% APR
  const loan: Debt = { id: "loan", name: "Loan", balance: 500_000, rateBps: 1000, minPayment: 10_000 }; // 10% APR
  const tiny: Debt = { id: "tiny", name: "Tiny", balance: 20_000, rateBps: 500, minPayment: 2_000 };

  it("monthly interest is exact and rounds half up", () => {
    expect(monthlyInterest(100_000, 3600)).toBe(3_000); // 1000.00 at 3% a month
    expect(monthlyInterest(100, 1200)).toBe(1); // 1.00 rounds to 1
    expect(monthlyInterest(50, 1200)).toBe(1); // 0.5 rounds up
    expect(monthlyInterest(0, 3600)).toBe(0);
    expect(monthlyInterest(100_000, 0)).toBe(0);
  });
  it("a single debt with a payment above interest is paid off and totals reconcile", () => {
    const r = simulatePayoff([card], 10_000, "avalanche");
    expect(r.feasible).toBe(true);
    expect(r.months).toBeGreaterThan(0);
    expect(r.totalPaid).toBe(card.balance + r.totalInterest); // every rupee paid is principal or interest
  });
  it("avalanche pays less interest than snowball when the big balance has the higher rate", () => {
    const big: Debt = { id: "big", name: "Big card", balance: 500_000, rateBps: 3600, minPayment: 10_000 };
    const small: Debt = { id: "small", name: "Small loan", balance: 50_000, rateBps: 500, minPayment: 2_000 };
    const av = simulatePayoff([big, small], 40_000, "avalanche");
    const sn = simulatePayoff([big, small], 40_000, "snowball");
    expect(av.feasible && sn.feasible).toBe(true);
    expect(av.totalInterest).toBeLessThan(sn.totalInterest);
    expect(sn.order[0]).toBe("small"); // snowball puts the extra money on the smallest balance
    expect(av.order[0]).toBe("big"); // avalanche puts it on the highest rate, so the big card finishes first
    expect(av.months).toBeLessThanOrEqual(sn.months);
  });
  it("when the same debt is both the smallest and the highest rate, the strategies agree", () => {
    const av = simulatePayoff([card, loan], 40_000, "avalanche");
    const sn = simulatePayoff([card, loan], 40_000, "snowball");
    expect(av.totalInterest).toBe(sn.totalInterest);
  });
  it("snowball targets the smallest balance first", () => {
    const sn = simulatePayoff([loan, tiny], 20_000, "snowball");
    expect(sn.order[0]).toBe("tiny");
    expect(sn.payoffMonth.tiny).toBeLessThan(sn.payoffMonth.loan);
  });
  it("freed-up minimums roll into the next debt (total months below paying minimums only)", () => {
    const withExtra = simulatePayoff([card, tiny], 15_000, "avalanche");
    const minsOnly = simulatePayoff([card, tiny], 5_000, "avalanche");
    expect(withExtra.months).toBeLessThan(minsOnly.months);
  });
  it("reports infeasible when the budget is below the minimums, or never covers interest", () => {
    expect(simulatePayoff([card, loan], 5_000, "avalanche").feasible).toBe(false);
    const heavy: Debt = { id: "h", name: "Heavy", balance: 1_000_000, rateBps: 4800, minPayment: 1_000 };
    expect(simulatePayoff([heavy], 1_000, "avalanche").feasible).toBe(false); // 40_000 interest/month vs 1_000 paid
  });
  it("nothing to pay is trivially done", () => {
    expect(simulatePayoff([], 10_000, "avalanche")).toMatchObject({ months: 0, feasible: true });
    expect(simulatePayoff([{ ...card, balance: 0 }], 10_000, "snowball")).toMatchObject({ months: 0, feasible: true });
  });
});
