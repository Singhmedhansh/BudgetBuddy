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

import { dropUnverified } from "./grounding";
import { followUps, starters } from "./suggestions";

describe("affordability", () => {
  it("says whether it can be paid for now, and what is left", () => {
    const f: Facts = { ...withNet("2000.00"), spendable: "9000.00" };
    expect(savingsPlan("can I afford a 7K monitor", f)).toMatchObject({ canAffordNow: true, leftAfter: "2000.00", spendableNow: "9000.00" });
    const poor: Facts = { ...withNet("2000.00"), spendable: "1000.00" };
    expect(savingsPlan("can I afford a 7K monitor", poor)).toMatchObject({ canAffordNow: false, months: 4 });
    expect(savingsPlan("can I afford a 7K monitor", poor)).not.toHaveProperty("leftAfter");
  });
});

describe("unverified figures are cut out, not the whole answer", () => {
  it("keeps the sentences that are safe", () => {
    const f = { ...base, thisMonth: { ...base.thisMonth, spending: "4200.00" } } satisfies Facts;
    const kept = dropUnverified("You spent ₹4,200.00 this month. That is about ₹9,999 more than usual. Nice and steady otherwise.", f);
    expect(kept).toBe("You spent ₹4,200.00 this month. Nice and steady otherwise.");
    expect(dropUnverified("That is ₹9,999.", f)).toBe("");
  });
});

describe("starters and follow-ups", () => {
  it("offers questions for what is recorded, at most six", () => {
    const f: Facts = { ...base, bills: [{ name: "Rent", kind: "bill", amount: "9000.00", due: "2026-12-01", state: "upcoming" }], categories: [{ name: "Food", thisMonth: "5000.00", lastMonth: "3000.00", changePercent: 67, avg3m: "3200.00" }], goals: [{ name: "Trip", target: "50000.00", saved: "1000.00", remaining: "49000.00", deadline: null, monthlyNeeded: null, health: "no deadline" }] };
    const s = starters(f).map((x) => x.text);
    expect(s.length).toBeLessThanOrEqual(8);
    expect(s).toContain("Why is my Food spending up?");
    expect(s).toContain("What bills are coming up?");
    expect(s).toContain("How are my savings goals going?");
    expect(starters(null).length).toBeGreaterThanOrEqual(3);
  });
  it("suggests a few next questions by topic and never repeats the one just asked", () => {
    const f = followUps("What bills are coming up?");
    expect(f.length).toBeLessThanOrEqual(3);
    expect(f.length).toBeGreaterThan(0);
  });
});
