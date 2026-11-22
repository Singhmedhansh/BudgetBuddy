import { describe, expect, it } from "vitest";
import { detectCalculation, emiBalanceByYear, growthByYear } from "./calculators";
import type { Facts } from "./grounding";
import { buildVisuals, niceTicks } from "./visuals";

const base = { asOf: "2026-11-22", space: { name: "Home", currency: "INR", sample: false }, netWorth: "20000.00", held: "25000.00", owed: "5000.00", accounts: [{ name: "Bank", type: "Savings", balance: "25000.00" }, { name: "Card", type: "Credit card", balance: "5000.00" }], thisMonth: { label: "November 2026", income: "50000.00", spending: "30000.00", net: "20000.00", keptPercent: 40 }, topCategories: [], budgets: [] } satisfies Facts;
const rich: Facts = {
  ...base,
  categories: [
    { name: "Food", thisMonth: "9000.00", lastMonth: "5000.00", changePercent: 80, avg3m: "5200.00" },
    { name: "Rent", thisMonth: "15000.00", lastMonth: "15000.00", changePercent: 0, avg3m: "15000.00" },
  ],
  history: [
    { label: "Sep 2026", income: "48000.00", spending: "30000.00", net: "18000.00" },
    { label: "Oct 2026", income: "50000.00", spending: "28000.00", net: "22000.00" },
  ],
  pace: { daysElapsed: 22, daysLeft: 8, dailyAverage: "1363.00", projectedMonthEnd: "40909.00", budgetLeftPerDay: null, savingsRatePercent: 40, monthsOfCover: 4.2 },
  budgets: [{ name: "Main", lines: [{ category: "Food", limit: "8000.00", spent: "9000.00", remaining: "0.00", overBy: "1000.00", state: "over" }] }],
  bills: [{ name: "Rent", kind: "bill", amount: "15000.00", due: "2026-12-01", state: "upcoming" }],
  goals: [{ name: "Trip", target: "50000.00", saved: "10000.00", remaining: "40000.00", deadline: null, monthlyNeeded: null, health: "behind" }],
  emergencyFund: { threeMonths: "90000.00", sixMonths: "180000.00", monthsHeld: 4.2 },
  rule503020: { basisIncome: "50000.00", needs: "25000.00", wants: "15000.00", savings: "10000.00" },
};
const types = (q: string, f: Facts = rich) => buildVisuals(q, f).map((v) => v.type);

describe("which picture goes with which question", () => {
  it("spending questions get a donut by category, plus the biggest increases", () => {
    expect(types("Where did most of my money go?")).toEqual(["donut", "bars"]);
  });
  it("trend questions get income against spending by month", () => {
    expect(types("Compare my income across months")).toEqual(["columns", "stats"]);
  });
  it("budgets, goals, bills, emergency fund and 50/30/20 each have their own", () => {
    expect(types("Am I on track with my budgets?")).toEqual(["progress"]);
    expect(types("How are my goals going?")).toEqual(["progress"]);
    expect(types("What bills are coming up?")).toEqual(["timeline"]);
    expect(types("How big should my emergency fund be?")).toEqual(["stats", "progress"]);
    expect(types("Explain the 50/30/20 rule for me")).toEqual(["donut"]);
  });
  it("net worth gets figures and balances by account", () => {
    expect(types("What is my net worth?")).toEqual(["stats", "bars"]);
  });
  it("a savings plan gets progress and key figures", () => {
    const f: Facts = { ...rich, savingsPlan: { target: "10000.00", perMonth: "1000.00", months: 10, spendableNow: "1200.00", canAffordNow: false } };
    expect(types("how many months to save 10K", f)).toEqual(["progress", "stats"]);
  });
  it("shows nothing for a question with no matching data", () => {
    expect(types("hello there", base)).toEqual([]);
    expect(types("Why is my food up?", base)).toEqual([]);
  });
});

describe("what-if charts", () => {
  it("EMI gets figures, a split of principal and interest, and a falling balance", () => {
    const calculation = detectCalculation("EMI on a 5 lakh loan at 10% for 3 years")!;
    const v = buildVisuals("EMI on a 5 lakh loan at 10% for 3 years", { ...base, calculation });
    expect(v.map((x) => x.type)).toEqual(["stats", "donut", "line"]);
    const line = v[2];
    if (line.type !== "line") throw new Error("expected a line");
    expect(line.series[0].points[0]).toBe(500000);
    expect(line.series[0].points.at(-1)).toBe(0);
  });
  it("SIP gets a growth line above the amount invested", () => {
    const calculation = detectCalculation("invest 5000 a month in a SIP at 12% for 10 years")!;
    const v = buildVisuals("sip", { ...base, calculation });
    const line = v.find((x) => x.type === "line");
    if (!line || line.type !== "line") throw new Error("expected a line");
    expect(line.series[0].points.at(-1)!).toBeGreaterThan(line.series[1].points.at(-1)!);
    expect(line.xLabels).toHaveLength(line.series[0].points.length);
  });
  it("balance and growth series have a point for the start and each year", () => {
    expect(emiBalanceByYear(120000, 12, 24)).toHaveLength(3);
    expect(growthByYear({ kind: "lumpsum", amount: 1000, ratePercent: 10, years: 3 }).value).toHaveLength(4);
  });
});

describe("axis ticks", () => {
  it("are round and cover the maximum", () => {
    for (const max of [7, 1234, 500000, 2_345_678]) {
      const t = niceTicks(max);
      expect(t[0]).toBe(0);
      expect(t.at(-1)!).toBeGreaterThanOrEqual(max);
      expect(t.length).toBeLessThanOrEqual(7);
    }
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});
