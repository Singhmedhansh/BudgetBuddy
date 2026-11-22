import { describe, expect, it } from "vitest";
import { referenceFor } from "@/config/reference-data";
import { detectCalculation } from "../calculators";
import { looksLikeAction } from "../finn-actions";
import type { Facts } from "../grounding";
import { detectScenario } from "../scenario";
import { buildVisuals } from "../visuals";
import { CASES } from "./cases";

const base = {
  asOf: "2026-11-22",
  space: { name: "Home", currency: "INR", sample: false },
  netWorth: "20000.00",
  held: "125000.00",
  owed: "5000.00",
  accounts: [
    { name: "HDFC Savings", type: "Savings", balance: "95000.00" },
    { name: "Cash", type: "Cash", balance: "30000.00" },
    { name: "Credit card", type: "Credit card", balance: "5000.00" },
  ],
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
      name: "Rent",
      thisMonth: "15000.00",
      lastMonth: "15000.00",
      changePercent: 0,
      avg3m: "15000.00",
    },
    {
      name: "Food",
      thisMonth: "9000.00",
      lastMonth: "5600.00",
      changePercent: 61,
      avg3m: "5200.00",
    },
    {
      name: "Shopping",
      thisMonth: "6500.00",
      lastMonth: "2100.00",
      changePercent: 210,
      avg3m: "2500.00",
    },
  ],
  history: [
    {
      label: "Sep 2026",
      income: "60000.00",
      spending: "44000.00",
      net: "16000.00",
    },
    {
      label: "Oct 2026",
      income: "60000.00",
      spending: "40000.00",
      net: "20000.00",
    },
    {
      label: "Nov 2026",
      income: "60000.00",
      spending: "42000.00",
      net: "18000.00",
    },
  ],
  pace: {
    daysElapsed: 22,
    daysLeft: 8,
    dailyAverage: "1909.00",
    projectedMonthEnd: "57272.00",
    budgetLeftPerDay: null,
    savingsRatePercent: 30,
    monthsOfCover: 2.4,
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
      name: "Rent",
      kind: "bill",
      amount: "15000.00",
      due: "2026-12-01",
      state: "upcoming",
    },
  ],
  subscriptions: {
    active: 4,
    monthlyTotal: "1850.00",
    yearlyTotal: "22200.00",
  },
  goals: [
    {
      name: "Trip",
      target: "50000.00",
      saved: "21000.00",
      remaining: "29000.00",
      deadline: null,
      monthlyNeeded: null,
      health: "on track",
    },
  ],
  emergencyFund: {
    threeMonths: "126000.00",
    sixMonths: "252000.00",
    monthsHeld: 2.4,
  },
  rule503020: {
    basisIncome: "60000.00",
    needs: "30000.00",
    wants: "18000.00",
    savings: "12000.00",
  },
};

describe(`saved question set (${CASES.length} questions)`, () => {
  it("has a useful number of cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
  });
  for (const c of CASES) {
    it(c.q, () => {
      expect(looksLikeAction(c.q)).toBe(Boolean(c.action));
      const calc = detectCalculation(c.q);
      expect(calc?.kind).toBe(c.calc);
      const scenario = detectScenario(c.q, rich);
      expect(Boolean(scenario)).toBe(Boolean(c.scenario));
      const ref = referenceFor(c.q).map((r) => r.label);
      if (c.reference) expect(ref).toEqual(expect.arrayContaining(c.reference));
      else expect(ref).toEqual([]);
      if (c.visuals) {
        const v = buildVisuals(c.q, {
          ...rich,
          ...(calc ? { calculation: calc } : {}),
          ...(scenario ? { scenario } : {}),
        });
        expect(v.map((x) => x.type)).toEqual(c.visuals);
      }
    });
  }
});
