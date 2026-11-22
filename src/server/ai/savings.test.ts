import { describe, expect, it } from "vitest";
import { savingsPlan, targetAmount, unverifiedFigures, type Facts } from "./grounding";

const base = { asOf: "2026-11-22", space: { name: "Home", currency: "INR", sample: false }, netWorth: "1200.14", held: "1200.14", owed: "0.00", accounts: [], thisMonth: { label: "November 2026", income: "0.00", spending: "0.00", net: "0.00", keptPercent: null }, topCategories: [], budgets: [] } satisfies Facts;
const withNet = (amount: string): Facts => ({ ...base, monthlyNet: { amount, months: 3 } });

describe("target amount in a question", () => {
  it("reads K, lakh and plain amounts", () => {
    expect(targetAmount("How much months should i save to be able to afford a monitor which is 7K inr?")).toBe(7000);
    expect(targetAmount("can I afford a 1.5 lakh bike, how many months?")).toBe(150000);
    expect(targetAmount("how long to save ₹45,000 for a phone")).toBe(45000);
  });
  it("ignores questions with no target or small counts", () => {
    expect(targetAmount("What is my net worth right now?")).toBeNull();
    expect(targetAmount("how much did I save in 3 months")).toBeNull();
  });
});

describe("savings plan", () => {
  it("rounds months up, computed by code", () => {
    expect(savingsPlan("how many months to save 7K", withNet("2000.00"))).toEqual({ target: "7000.00", perMonth: "2000.00", months: 4 });
    expect(savingsPlan("how many months to save 7K", withNet("3500.00"))?.months).toBe(2);
  });
  it("says it cannot be reached when nothing is saved, and does nothing without history", () => {
    expect(savingsPlan("save 7K", withNet("-100.00"))?.months).toBeNull();
    expect(savingsPlan("save 7K", base)).toBeUndefined();
  });
  it("an answer that quotes the plan's figures passes verification", () => {
    const facts = { ...withNet("2000.00"), savingsPlan: savingsPlan("save 7K", withNet("2000.00")) };
    expect(unverifiedFigures("To save ₹7,000 at ₹2,000.00 a month takes 4 months.", facts)).toEqual([]);
  });
});
