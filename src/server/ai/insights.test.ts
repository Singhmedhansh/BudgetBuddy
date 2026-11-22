import { describe, expect, it } from "vitest";
import { referenceFor } from "@/config/reference-data";
import type { Facts } from "./grounding";
import { insightsFrom } from "./insights";
import { detectScenario } from "./scenario";
import { buildVisuals } from "./visuals";

const base = {
  asOf: "2026-11-22",
  space: { name: "Home", currency: "INR", sample: false },
  netWorth: "20000.00",
  held: "25000.00",
  owed: "5000.00",
  accounts: [],
  thisMonth: {
    label: "November 2026",
    income: "60000.00",
    spending: "42000.00",
    net: "18000.00",
    keptPercent: 30,
  },
  topCategories: [],
  budgets: [],
} satisfies Facts;
const rich: Facts = {
  ...base,
  monthlyNet: { amount: "18000.00", months: 3 },
  categories: [
    {
      name: "Food",
      thisMonth: "9000.00",
      lastMonth: "5000.00",
      changePercent: 80,
      avg3m: "5000.00",
    },
    {
      name: "Rent",
      thisMonth: "15000.00",
      lastMonth: "15000.00",
      changePercent: 0,
      avg3m: "15000.00",
    },
  ],
  history: [
    { label: "Aug", income: "60000.00", spending: "36000.00", net: "24000.00" },
    { label: "Sep", income: "60000.00", spending: "40000.00", net: "20000.00" },
    { label: "Oct", income: "60000.00", spending: "40000.00", net: "20000.00" },
    { label: "Nov", income: "60000.00", spending: "42000.00", net: "18000.00" },
  ],
  pace: {
    daysElapsed: 12,
    daysLeft: 18,
    dailyAverage: "3500.00",
    projectedMonthEnd: "105000.00",
    budgetLeftPerDay: null,
    savingsRatePercent: 30,
    monthsOfCover: 2,
  },
  budgets: [
    {
      name: "Main",
      lines: [
        {
          category: "Food",
          limit: "8000.00",
          spent: "9000.00",
          remaining: "0.00",
          overBy: "1000.00",
          state: "over",
        },
      ],
    },
  ],
  bills: [
    {
      name: "Electricity",
      kind: "bill",
      amount: "2300.00",
      due: "2026-11-20",
      state: "overdue",
    },
  ],
};

describe("what-if scenarios", () => {
  it("works out a category cut from the usual month, in code", () => {
    expect(
      detectScenario("What if I cut my Food spending by 20%?", rich),
    ).toEqual({
      what: "Food",
      percent: 20,
      usualMonthly: "5000.00",
      newMonthly: "4000.00",
      savesPerMonth: "1000.00",
      savesPerYear: "12000.00",
      monthlySavingNow: "18000.00",
      monthlySavingAfter: "19000.00",
    });
  });
  it("overall spending, and nothing when it is not a what-if", () => {
    expect(
      detectScenario("what if I reduce my spending by 10%", rich),
    ).toMatchObject({ what: "overall spending", savesPerMonth: "3866.67" });
    expect(
      detectScenario("How much did I spend on Food?", rich),
    ).toBeUndefined();
    expect(detectScenario("what if I cut Food", rich)).toBeUndefined();
  });
  it("draws the comparison", () => {
    const v = buildVisuals("What if I cut my Food spending by 20%?", {
      ...rich,
      scenario: detectScenario("What if I cut my Food spending by 20%?", rich),
    });
    expect(v.map((x) => x.type)).toEqual(["stats", "bars", "bars"]);
  });
});

describe("what Finn noticed", () => {
  it("lists the important things first and no more than four", () => {
    const i = insightsFrom(rich);
    expect(i.length).toBeLessThanOrEqual(4);
    expect(i[0].tone).toBe("warn");
    expect(i.map((x) => x.text).join(" ")).toMatch(/Food is ₹1,000 over/);
    expect(i.map((x) => x.text).join(" ")).toMatch(/Electricity .* overdue/);
    expect(i.some((x) => /Food is up 80%/.test(x.text))).toBe(true);
  });
  it("says nothing when there is nothing to say", () => {
    expect(
      insightsFrom({
        ...base,
        thisMonth: { ...base.thisMonth, income: "0.00" },
      }),
    ).toEqual([]);
  });
});

describe("reference figures", () => {
  it("attaches the dated figure a question needs, with its source", () => {
    const r = referenceFor("What is the current PPF rate?");
    expect(r[0]).toMatchObject({ label: "PPF interest rate" });
    expect(r[0].asOf).toMatch(/2026/);
    expect(r[0].source).toBeTruthy();
    expect(referenceFor("what is the repo rate").map((x) => x.label)).toEqual([
      "RBI repo rate",
    ]);
    expect(referenceFor("Which tax slab am I in?")[0].label).toMatch(
      /Income tax/,
    );
  });
  it("attaches nothing for an unrelated question", () => {
    expect(referenceFor("How much did I spend on food?")).toEqual([]);
  });
});
