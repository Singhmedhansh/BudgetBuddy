import { describe, expect, it } from "vitest";
import { merchantTotals, monthsBack, percentChange, shares } from "./analytics";

describe("percentChange", () => {
  it("computes change and refuses a zero base", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe("monthsBack", () => {
  it("returns n months oldest first across a year boundary", () => {
    expect(monthsBack(2026, 2, 4)).toEqual([{ year: 2025, month: 11 }, { year: 2025, month: 12 }, { year: 2026, month: 1 }, { year: 2026, month: 2 }]);
    expect(monthsBack(2026, 11, 1)).toEqual([{ year: 2026, month: 11 }]);
  });
});

describe("shares", () => {
  it("percentages always add to exactly 100", () => {
    for (const amounts of [[1, 1, 1], [333, 333, 334], [1, 2, 3, 4, 5, 6, 7], [99, 1], [1]]) {
      const s = shares(amounts.map((a, i) => ({ key: String(i), amount: a })));
      expect(s.reduce((t, x) => t + x.percent, 0)).toBe(100);
    }
  });
  it("sorts largest first and ignores zero and negative amounts", () => {
    const s = shares([{ key: "a", amount: 10 }, { key: "b", amount: 30 }, { key: "c", amount: 0 }, { key: "d", amount: -5 }]);
    expect(s.map((x) => x.key)).toEqual(["b", "a"]);
    expect(s.map((x) => x.percent)).toEqual([75, 25]);
  });
  it("is empty when there is nothing to share", () => {
    expect(shares([])).toEqual([]);
    expect(shares([{ key: "a", amount: 0 }])).toEqual([]);
  });
});

describe("merchantTotals", () => {
  it("sums spending per merchant case-insensitively and counts purchases", () => {
    const r = merchantTotals([
      { id: "1", type: "expense", merchant: "Fresh Basket", expenseAmount: 1000 },
      { id: "2", type: "expense", merchant: "fresh basket", expenseAmount: 500 },
      { id: "3", type: "expense", merchant: "City Cabs", expenseAmount: 300 },
    ]);
    expect(r).toEqual([{ merchant: "Fresh Basket", amount: 1500, count: 2 }, { merchant: "City Cabs", amount: 300, count: 1 }]);
  });
  it("regression: a reversed purchase nets to zero and no merchant called Reversal appears", () => {
    const r = merchantTotals([
      { id: "1", type: "expense", merchant: "Fresh Basket", expenseAmount: 184250 },
      { id: "2", type: "expense", merchant: null, expenseAmount: -184250, reversalOf: "1" },
      { id: "3", type: "expense", merchant: "City Cabs", expenseAmount: 380 },
    ]);
    expect(r).toEqual([{ merchant: "City Cabs", amount: 380, count: 1 }]);
  });
  it("a refund reduces the merchant it refunds", () => {
    const r = merchantTotals([
      { id: "1", type: "expense", merchant: "Shop", expenseAmount: 10000 },
      { id: "2", type: "refund", merchant: null, expenseAmount: -4000, refundOf: "1" },
    ]);
    expect(r).toEqual([{ merchant: "Shop", amount: 6000, count: 1 }]);
  });
  it("ignores income, transfers and transactions without a merchant", () => {
    const r = merchantTotals([
      { id: "1", type: "income", merchant: "Acme", expenseAmount: 0 },
      { id: "2", type: "transfer", merchant: null, expenseAmount: 0 },
      { id: "3", type: "expense", merchant: null, expenseAmount: 500 },
    ]);
    expect(r).toEqual([]);
  });
});
