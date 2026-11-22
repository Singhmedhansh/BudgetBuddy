/**
 * Reference figures Finn may quote, each with the date it was checked and where it comes from. Rates and rules change,
 * so Finn always states the date and tells the person to confirm at the source. Update this file when a rate changes;
 * a figure not in this list is never quoted from memory as if it were current.
 *
 * Last reviewed: 22 Nov 2026, from the RBI, the Finance Ministry's quarterly notification and the Income Tax Department,
 * as reported by Business Standard, Business Today and Scroll.
 */
export interface Reference {
  id: string;
  /** Words in a question that make this figure relevant. */
  match: RegExp;
  label: string;
  value: string;
  asOf: string;
  source: string;
}

export const REFERENCE_DATA: Reference[] = [
  {
    id: "repo",
    match:
      /\b(repo|rbi|policy rate|interest rates? (?:going|cut|rise|hike)|rate cut)\b/i,
    label: "RBI repo rate",
    value:
      "5.25%, held unchanged at the June 2026 policy (last cut was 5 Dec 2025)",
    asOf: "June 2026 policy; later meetings not confirmed",
    source: "rbi.org.in",
  },
  {
    id: "ppf",
    match: /\bppf\b|public provident/i,
    label: "PPF interest rate",
    value:
      "7.1% a year, compounded annually; 15-year lock-in, up to 1.5 lakh a year",
    asOf: "Oct to Dec 2026 quarter (unchanged for many quarters)",
    source: "Finance Ministry quarterly notification",
  },
  {
    id: "ssy",
    match: /\bsukanya|ssy\b/i,
    label: "Sukanya Samriddhi rate",
    value: "8.2% a year",
    asOf: "Oct to Dec 2026 quarter",
    source: "Finance Ministry quarterly notification",
  },
  {
    id: "scss",
    match: /\bscss|senior citizen(?:s)? savings/i,
    label: "Senior Citizens Savings Scheme rate",
    value: "8.2% a year",
    asOf: "Oct to Dec 2026 quarter",
    source: "Finance Ministry quarterly notification",
  },
  {
    id: "nsc",
    match:
      /\bnsc\b|national savings cert|post office (?:monthly|mis)|\bpomis\b/i,
    label: "NSC and Post Office Monthly Income rates",
    value: "NSC 7.7% a year, Post Office Monthly Income Scheme 7.4% a year",
    asOf: "Jul to Sep 2026 table, rates held unchanged since",
    source: "Finance Ministry quarterly notification",
  },
  {
    id: "epf",
    match: /\bepf\b|provident fund|\bepfo\b/i,
    label: "EPF interest rate",
    value: "8.25% for FY 2024-25",
    asOf: "FY 2024-25; the rate is declared each year",
    source: "epfindia.gov.in",
  },
  {
    id: "tax",
    match:
      /\b(tax|slab|itr|rebate|87a|standard deduction|new regime|old regime|80c)\b/i,
    label: "Income tax, new regime (resident individual)",
    value:
      "No tax up to 4 lakh; 5% from 4 to 8 lakh; 10% from 8 to 12 lakh; 15% from 12 to 16 lakh; 20% from 16 to 20 lakh; 25% from 20 to 24 lakh; 30% above 24 lakh. Rebate under 87A of 60,000, so no tax up to 12 lakh of taxable income. Standard deduction for salaried people 75,000. The old regime keeps deductions such as 80C (up to 1.5 lakh) with older slabs",
    asOf: "FY 2025-26 schedule, which FY 2026-27 pages also show; check the year you are filing for",
    source: "incometax.gov.in",
  },
];

/** The figures relevant to a question, at most three. Pure, so it is tested. */
export function referenceFor(
  question: string,
): { label: string; value: string; asOf: string; source: string }[] {
  return REFERENCE_DATA.filter((r) => r.match.test(question))
    .slice(0, 3)
    .map(({ label, value, asOf, source }) => ({ label, value, asOf, source }));
}
