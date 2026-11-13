import { describe, expect, it } from "vitest";
import { starterCategories } from "@/config/categories";
import { buildSampleDataset, isSampleSpace, SAMPLE_SPACE_NAME } from "./sample-data";

const day = (year: number, month: number, d: number) => ({ year, month, day: d });
const DATES = [day(2026, 11, 13), day(2026, 1, 1), day(2026, 3, 31), day(2026, 12, 31), day(2027, 2, 28), day(2026, 6, 15)];
const iso = (d: { y: number; m: number; d: number }) => `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;

describe("sample dataset", () => {
  it("is clearly labelled as fictional sample data", () => {
    const ds = buildSampleDataset(day(2026, 11, 13));
    expect(ds.spaceName).toBe(SAMPLE_SPACE_NAME);
    expect(ds.spaceName).toMatch(/Sample data/);
    expect(ds.spaceName).toMatch(/fictional/);
    for (const a of ds.accounts) expect(a.name).toMatch(/\(sample\)/);
    expect(isSampleSpace({ name: ds.spaceName })).toBe(true);
    expect(isSampleSpace({ name: "Rao family" })).toBe(false);
    expect(isSampleSpace({ name: "Anything", is_sample: true })).toBe(true);
    expect(isSampleSpace(null)).toBe(false);
  });

  it("is deterministic for a given date", () => {
    expect(buildSampleDataset(day(2026, 11, 13))).toEqual(buildSampleDataset(day(2026, 11, 13)));
  });

  it.each(DATES)("is consistent for %j", (today) => {
    const ds = buildSampleDataset(today);
    const todayIso = iso({ y: today.year, m: today.month, d: today.day });
    const expense = new Set(starterCategories("household").filter((c) => c.kind === "expense").map((c) => c.name));
    const income = new Set(starterCategories("household").filter((c) => c.kind === "income").map((c) => c.name));
    const accounts = new Set(ds.accounts.map((a) => a.key));

    expect(ds.transactions.length).toBeGreaterThan(30);
    for (const t of ds.transactions) {
      expect(iso(t.date) <= todayIso, `${iso(t.date)} is after ${todayIso}`).toBe(true); // the app refuses future dates
      expect(Number.isSafeInteger(t.amount) && t.amount > 0).toBe(true);
      expect(accounts.has(t.from)).toBe(true);
      if (t.kind === "transfer") {
        expect(t.to && accounts.has(t.to) && t.to !== t.from).toBe(true);
      } else if (t.kind === "expense") {
        expect(expense.has(t.category!), `unknown expense category ${t.category}`).toBe(true);
      } else {
        expect(income.has(t.category!), `unknown income source ${t.category}`).toBe(true);
      }
    }
    for (const b of ds.budgets) for (const l of b.lines) expect(expense.has(l.category)).toBe(true);
    for (const r of ds.recurring) expect(r.kind === "income" ? income.has(r.category) : expense.has(r.category)).toBe(true);
  });

  it.each(DATES)("never overdraws a cash or bank account on %j", (today) => {
    const ds = buildSampleDataset(today);
    const bal: Record<string, number> = Object.fromEntries(ds.accounts.map((a) => [a.key, a.type === "credit_card" ? -a.opening : a.opening]));
    for (const t of ds.transactions) {
      if (t.kind === "income") bal[t.from] += t.amount;
      else if (t.kind === "expense") bal[t.from] -= t.amount;
      else {
        bal[t.from] -= t.amount;
        bal[t.to!] += t.amount;
      }
      for (const key of ["bank", "savings", "wallet"]) expect(bal[key], `${key} went negative on ${iso(t.date)}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("covers the situations the budget and dashboard screens need to show", () => {
    const ds = buildSampleDataset(day(2026, 11, 20));
    const kinds = new Set(ds.transactions.map((t) => t.kind));
    expect(kinds).toEqual(new Set(["expense", "income", "transfer"]));
    expect(new Set(ds.transactions.map((t) => iso(t.date).slice(0, 7))).size).toBe(3); // three months of history
    expect(ds.budgets[0].lines.length).toBeGreaterThanOrEqual(4);
    expect(ds.goals[0].contributions.length).toBeGreaterThan(0);
    expect(ds.recurring.map((r) => r.kind).sort()).toEqual(["bill", "bill", "income", "subscription"]);
  });

  it("contains no real-looking personal data", () => {
    const text = JSON.stringify(buildSampleDataset(day(2026, 11, 13)));
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); // no email addresses
    expect(text).not.toMatch(/\b\d{10,}\b/); // no phone or account numbers
  });
});
