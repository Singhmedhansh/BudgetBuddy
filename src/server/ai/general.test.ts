import { describe, expect, it } from "vitest";
import { detectCalculation, emi, lumpsum, sip } from "./calculators";
import { enforceFigures, splitTag, type Facts } from "./grounding";

const base = {
  asOf: "2026-11-22",
  space: { name: "Home", currency: "INR", sample: false },
  netWorth: "1200.14",
  held: "1200.14",
  owed: "0.00",
  accounts: [],
  thisMonth: {
    label: "November 2026",
    income: "0.00",
    spending: "0.00",
    net: "0.00",
    keptPercent: null,
  },
  topCategories: [],
  budgets: [],
} satisfies Facts;

describe("calculators", () => {
  it("EMI matches the standard formula", () => {
    const r = emi(500_000, 10, 36);
    expect(r.payment).toBeCloseTo(16133.59, 1);
    expect(r.interest).toBeCloseTo(r.total - 500_000, 6);
    expect(emi(12_000, 0, 12).payment).toBe(1000);
  });
  it("SIP and lump sum growth", () => {
    expect(sip(1000, 0, 1).value).toBe(12_000);
    expect(sip(5000, 12, 10).value).toBeGreaterThan(5000 * 120);
    expect(lumpsum(100_000, 10, 2)).toBeCloseTo(121_000, 6);
  });
  it("detects an EMI question with its numbers, in lakh and plain forms", () => {
    const c = detectCalculation(
      "What would the EMI be on a 5 lakh loan at 10% for 3 years?",
    );
    expect(c).toMatchObject({
      kind: "emi",
      loanAmount: "500000.00",
      ratePercent: 10,
      months: 36,
    });
    expect(
      detectCalculation("emi for a loan of 2,00,000 at 9.5% for 24 months"),
    ).toMatchObject({ kind: "emi", months: 24, loanAmount: "200000.00" });
  });
  it("detects a SIP and a lump sum", () => {
    expect(
      detectCalculation(
        "If I invest 5000 a month in a SIP at 12% for 10 years what do I get?",
      ),
    ).toMatchObject({ kind: "sip", years: 10, monthlyInvestment: "5000.00" });
    expect(
      detectCalculation(
        "How much will 1 lakh in an FD at 7% be worth after 5 years?",
      ),
    ).toMatchObject({ kind: "lumpsum", amount: "100000.00", years: 5 });
  });
  it("returns nothing when numbers are missing or absurd", () => {
    expect(detectCalculation("What is an EMI?")).toBeNull();
    expect(detectCalculation("loan at 10% for 3 years")).toBeNull();
    expect(detectCalculation("loan of 5 lakh at 900% for 3 years")).toBeNull();
  });
});

describe("answer tags and figure rules", () => {
  it("reads the tag and defaults to the strict records mode", () => {
    expect(splitTag("[G] Hello there")).toEqual({
      tag: "G",
      body: "Hello there",
    });
    expect(splitTag("[a]\nHi")).toEqual({ tag: "A", body: "Hi" });
    expect(splitTag("No tag")).toEqual({ tag: "A", body: "No tag" });
  });
  it("lets a general answer quote benchmarks but never the person's own made-up figures", () => {
    const r = enforceFigures(
      "Experts usually suggest 3 to 6 months of expenses, and the PPF rate is around 7.1%. You have ₹55,000 saved.",
      "G",
      base,
    );
    expect(r?.text).toContain("PPF rate is around 7.1%");
    expect(r?.text).not.toContain("55,000");
  });
  it("keeps a records answer strict, but spares a plain benchmark sentence that does not address the person", () => {
    const r = enforceFigures(
      "Your net worth is ₹1,200.14. Experts usually suggest saving at least 20% of income. Your savings rate is 35%.",
      "A",
      base,
    );
    expect(r?.text).toContain("1,200.14");
    expect(r?.text).toContain("at least 20%");
    expect(r?.text).not.toContain("35%");
    expect(enforceFigures("Your balance is ₹9,999.", "A", base)).toBeNull();
  });
});
