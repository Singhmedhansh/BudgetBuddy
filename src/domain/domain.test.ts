import { describe, expect, it } from "vitest";
import { allocate, formatMoney, parseAmount, toDecimalString, MoneyError } from "./money";
import {
  accountBalance,
  adjustmentPosting,
  assertBalanced,
  expensePosting,
  incomePosting,
  LedgerAccount,
  LedgerError,
  netWorth,
  periodTotals,
  Posting,
  refundPosting,
  reversePosting,
  spendingByCategory,
  transferPosting,
} from "./ledger";
import { monthRange, localDate } from "./period";
import { alertLevel, budgetStatus, rolloverAmount } from "./budget";

const accounts: LedgerAccount[] = [
  { id: "bank", kind: "asset", currency: "INR" },
  { id: "cash", kind: "asset", currency: "INR" },
  { id: "card", kind: "liability", currency: "INR" },
  { id: "food", kind: "expense", currency: "INR" },
  { id: "rent", kind: "expense", currency: "INR" },
  { id: "salary", kind: "income", currency: "INR" },
  { id: "equity", kind: "equity", currency: "INR" },
];
const bal = (id: string, ps: Posting[]) => accountBalance(accounts.find((a) => a.id === id)!, ps);
const d = (s: string) => new Date(s);

describe("money", () => {
  it("parses exact decimals without float error", () => {
    expect(parseAmount("0.1", "INR") + parseAmount("0.2", "INR")).toBe(30);
    expect(parseAmount("1,234.50", "INR")).toBe(123450);
    expect(parseAmount("500", "JPY")).toBe(500);
    expect(parseAmount("1.234", "KWD")).toBe(1234);
  });
  it("rejects excess precision instead of rounding", () => {
    expect(() => parseAmount("10.123", "INR")).toThrow(MoneyError);
    expect(() => parseAmount("10.5", "JPY")).toThrow(MoneyError);
    expect(() => parseAmount("abc", "INR")).toThrow(MoneyError);
  });
  it("round-trips and formats", () => {
    expect(toDecimalString(5, "INR")).toBe("0.05");
    expect(toDecimalString(-123456, "INR")).toBe("-1234.56");
    expect(formatMoney(123456, "INR", "en-IN")).toBe("₹1,234.56");
  });
  it("allocates without losing or creating minor units", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(100);
    expect(allocate(-100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(-100);
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
  });
});

describe("ledger scenarios (spec 19.2)", () => {
  it("1/2: expense and income change the account balance", () => {
    const ps = [
      incomePosting({ id: "i1", occurredAt: d("2026-11-01"), amount: 5_000_000, accountId: "bank", sourceId: "salary" }),
      expensePosting({ id: "e1", occurredAt: d("2026-11-02"), amount: 123_450, accountId: "bank", categoryId: "food" }),
    ];
    ps.forEach(assertBalanced);
    expect(bal("bank", ps)).toBe(5_000_000 - 123_450);
  });

  it("3: transfer between own accounts leaves net worth and totals unchanged", () => {
    const base = [incomePosting({ id: "i", occurredAt: d("2026-11-01"), amount: 100_000, accountId: "bank", sourceId: "salary" })];
    const before = netWorth(accounts, base);
    const ps = [...base, transferPosting({ id: "t", occurredAt: d("2026-11-03"), amount: 40_000, fromAccountId: "bank", toAccountId: "cash" })];
    expect(netWorth(accounts, ps)).toBe(before);
    expect(bal("bank", ps)).toBe(60_000);
    expect(bal("cash", ps)).toBe(40_000);
    const totals = periodTotals(accounts, ps, d("2026-11-01"), d("2026-12-01"));
    expect(totals).toEqual({ income: 100_000, expenses: 0, net: 100_000 });
  });

  it("4: credit card purchase then repayment is counted as spending once", () => {
    const ps = [
      incomePosting({ id: "i", occurredAt: d("2026-11-01"), amount: 100_000, accountId: "bank", sourceId: "salary" }),
      expensePosting({ id: "buy", occurredAt: d("2026-11-05"), amount: 30_000, accountId: "card", categoryId: "food" }),
    ];
    expect(bal("card", ps)).toBe(30_000); // owed
    expect(netWorth(accounts, ps)).toBe(100_000 - 30_000);
    const repaid = [...ps, transferPosting({ id: "pay", occurredAt: d("2026-11-20"), amount: 30_000, fromAccountId: "bank", toAccountId: "card" })];
    expect(bal("card", repaid)).toBe(0);
    expect(bal("bank", repaid)).toBe(70_000);
    expect(netWorth(accounts, repaid)).toBe(70_000); // unchanged by the repayment
    expect(periodTotals(accounts, repaid, d("2026-11-01"), d("2026-12-01")).expenses).toBe(30_000);
  });

  it("5: refund links to the original, nets the category, and cannot exceed it", () => {
    const orig = expensePosting({ id: "e", occurredAt: d("2026-11-02"), amount: 10_000, accountId: "bank", categoryId: "food" });
    const r1 = refundPosting({ id: "r1", occurredAt: d("2026-11-04"), amount: 4_000, accountId: "bank" }, orig, [orig]);
    expect(r1.refundOf).toBe("e");
    const ps = [orig, r1];
    expect(spendingByCategory(accounts, ps, d("2026-11-01"), d("2026-12-01")).get("food")).toBe(6_000);
    expect(bal("bank", ps)).toBe(-6_000);
    expect(() => refundPosting({ id: "r2", occurredAt: d("2026-11-05"), amount: 6_001, accountId: "bank" }, orig, ps)).toThrow(LedgerError);
    expect(() => refundPosting({ id: "r2", occurredAt: d("2026-11-05"), amount: 6_000, accountId: "bank" }, orig, ps)).not.toThrow();
  });

  it("a reversed refund frees the refundable amount again", () => {
    const orig = expensePosting({ id: "e", occurredAt: d("2026-11-02"), amount: 10_000, accountId: "bank", categoryId: "food" });
    const r1 = refundPosting({ id: "r1", occurredAt: d("2026-11-04"), amount: 10_000, accountId: "bank" }, orig, [orig]);
    const rev = reversePosting(r1, "rev", d("2026-11-06"));
    expect(() => refundPosting({ id: "r2", occurredAt: d("2026-11-07"), amount: 10_000, accountId: "bank" }, orig, [orig, r1, rev])).not.toThrow();
  });

  it("9: pending (expected) postings do not move balances or totals", () => {
    const pending = incomePosting({ id: "p", occurredAt: d("2026-11-28"), amount: 99_999, accountId: "bank", sourceId: "salary", status: "pending" });
    expect(bal("bank", [pending])).toBe(0);
    expect(periodTotals(accounts, [pending], d("2026-11-01"), d("2026-12-01")).income).toBe(0);
  });

  it("10: reversal nets to zero and preserves both postings", () => {
    const e = expensePosting({ id: "e", occurredAt: d("2026-11-02"), amount: 5_000, accountId: "bank", categoryId: "food" });
    const rev = reversePosting(e, "rev", d("2026-11-03"));
    assertBalanced(rev);
    expect(rev.reversalOf).toBe("e");
    const ps = [e, rev];
    expect(ps).toHaveLength(2);
    expect(bal("bank", ps)).toBe(0);
    expect(spendingByCategory(accounts, ps, d("2026-11-01"), d("2026-12-01")).get("food")).toBe(0);
  });

  it("adjustments move the account against equity, not income or expense", () => {
    const a = adjustmentPosting({ id: "a", occurredAt: d("2026-11-01"), amount: 25_000, accountId: "bank", equityId: "equity" });
    expect(bal("bank", [a])).toBe(25_000);
    expect(periodTotals(accounts, [a], d("2026-11-01"), d("2026-12-01"))).toEqual({ income: 0, expenses: 0, net: 0 });
  });

  it("rejects invalid postings", () => {
    expect(() => expensePosting({ id: "x", occurredAt: d("2026-11-01"), amount: 0, accountId: "bank", categoryId: "food" })).toThrow(LedgerError);
    expect(() => expensePosting({ id: "x", occurredAt: d("2026-11-01"), amount: 1.5, accountId: "bank", categoryId: "food" })).toThrow(LedgerError);
    expect(() => transferPosting({ id: "x", occurredAt: d("2026-11-01"), amount: 1, fromAccountId: "bank", toAccountId: "bank" })).toThrow(LedgerError);
  });
});

describe("period boundaries and timezones (spec 19.2 #12)", () => {
  it("IST month starts 5h30m before UTC midnight", () => {
    const r = monthRange(2026, 11, "Asia/Kolkata");
    expect(r.from.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });
  it("a transaction near midnight lands in different months for different users", () => {
    const instant = d("2026-10-31T20:00:00Z");
    expect(localDate(instant, "UTC").month).toBe(10);
    expect(localDate(instant, "Asia/Kolkata").month).toBe(11);
    const e = expensePosting({ id: "e", occurredAt: instant, amount: 100, accountId: "bank", categoryId: "food" });
    const ist = monthRange(2026, 11, "Asia/Kolkata");
    const utc = monthRange(2026, 11, "UTC");
    expect(periodTotals(accounts, [e], ist.from, ist.to).expenses).toBe(100);
    expect(periodTotals(accounts, [e], utc.from, utc.to).expenses).toBe(0);
  });
  it("the boundary instant belongs to the later period", () => {
    const { from, to } = monthRange(2026, 11, "Asia/Kolkata");
    const onBoundary = expensePosting({ id: "e", occurredAt: to, amount: 100, accountId: "bank", categoryId: "food" });
    expect(periodTotals(accounts, [onBoundary], from, to).expenses).toBe(0);
  });
  it("handles DST: US spring-forward month length", () => {
    const r = monthRange(2026, 3, "America/New_York");
    expect(r.from.toISOString()).toBe("2026-03-01T05:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-04-01T04:00:00.000Z");
  });
});

describe("budgets (spec 5.5)", () => {
  it("computes remaining, over-budget and ratio", () => {
    const s = budgetStatus({ allocated: 10_000, actual: 6_000, committed: 1_000, expectedRemaining: 2_000 });
    expect(s.remaining).toBe(3_000);
    expect(s.overBudget).toBe(0);
    expect(s.forecast).toBe(8_000);
    expect(s.usedRatio).toBeCloseTo(0.7);
  });
  it("8: alerts at threshold and when over", () => {
    expect(alertLevel(budgetStatus({ allocated: 10_000, actual: 7_900 }))).toBe("ok");
    expect(alertLevel(budgetStatus({ allocated: 10_000, actual: 8_000 }))).toBe("warning");
    expect(alertLevel(budgetStatus({ allocated: 10_000, actual: 10_000 }))).toBe("warning");
    const over = budgetStatus({ allocated: 10_000, actual: 10_001 });
    expect(alertLevel(over)).toBe("over");
    expect(over.overBudget).toBe(1);
  });
  it("a zero allocation with spend is over, without dividing by zero", () => {
    const s = budgetStatus({ allocated: 0, actual: 500 });
    expect(s.usedRatio).toBeNull();
    expect(alertLevel(s)).toBe("over");
  });
  it("rollover carries unspent amount only unless overspend carry is enabled", () => {
    expect(rolloverAmount({ allocated: 10_000, actual: 7_000 }, { enabled: true })).toBe(3_000);
    expect(rolloverAmount({ allocated: 10_000, actual: 12_000 }, { enabled: true })).toBe(0);
    expect(rolloverAmount({ allocated: 10_000, actual: 12_000 }, { enabled: true, carryOverspend: true })).toBe(-2_000);
    expect(rolloverAmount({ allocated: 10_000, actual: 1_000 }, { enabled: false })).toBe(0);
  });
});
