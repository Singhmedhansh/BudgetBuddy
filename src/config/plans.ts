/**
 * Central plan and price configuration. The UI reads prices from here and the
 * billing domain will map each price to gateway-specific IDs on the server.
 * Amounts are minor units. Launch prices are illustrative and subject to
 * market validation (spec 11.1); change them here only.
 */
export type PlanId = "free" | "pro";
export type Interval = "month" | "year";

export interface Price {
  currency: "INR" | "USD";
  interval: Interval;
  amountMinor: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  summary: string;
  features: string[];
  prices: Price[];
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    summary: "Everything you need to run your money day to day.",
    features: [
      "Manual transactions, accounts and wallets",
      "Monthly budgets with alerts",
      "Savings goals",
      "CSV import with preview and duplicate checks",
      "Core dashboard and basic analytics",
      "Export and delete your data any time",
    ],
    prices: [{ currency: "INR", interval: "month", amountMinor: 0 }],
  },
  {
    id: "pro",
    name: "Pro",
    summary: "More depth for people who want to look ahead.",
    features: [
      "Everything in Free",
      "Forecasting and what-if scenarios",
      "AI assistant with a monthly allowance",
      "Advanced analytics and downloadable reports",
      "Smart categorisation and larger imports",
      "Automation rules",
    ],
    prices: [
      { currency: "INR", interval: "month", amountMinor: 14900 },
      { currency: "INR", interval: "year", amountMinor: 119900 },
    ],
  },
];

export function priceFor(plan: Plan, interval: Interval, currency: Price["currency"] = "INR"): Price | undefined {
  return plan.prices.find((p) => p.interval === interval && p.currency === currency);
}
