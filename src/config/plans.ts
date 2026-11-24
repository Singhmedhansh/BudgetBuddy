/**
 * Central plan and price configuration. The UI reads prices from here and the
 * billing domain will map each price to gateway-specific IDs on the server.
 * Amounts are minor units. Launch prices are illustrative and subject to
 * market validation (spec 11.1); change them here only.
 */
/** Free days before the first charge of FinTrack One. The yearly plan is then charged automatically unless the person cancels first. */
export const TRIAL_DAYS = 5;

/**
 * `PlanId` values are stored in the database (entitlements.plan) and must not change with the brand;
 * only `name` below is shown to people. "pro" is the stored id of FinTrack One.
 */
export type PlanId = "free" | "pro";
export type Interval = "month" | "year";

/**
 * What Finn, the money assistant, may be asked on each plan, counted over a rolling window the way other assistants
 * count (20 messages in any 5 hours on Free), with a daily ceiling, a per-minute burst guard and a monthly token backstop
 * (a question is roughly 3,000 to 3,500 tokens with the person's figures attached). Quick records Finn makes in code
 * ("400 on food") never count. scansPerDay is for reading photos of bills. See docs/finn-first-plan.md, section 2.
 */
export interface AiAllowance {
  questionsPerWindow: number;
  windowHours: number;
  questionsPerDay: number;
  perMinute: number;
  scansPerDay: number;
  tokensPerMonth: number;
}
export const AI_ALLOWANCE: Record<PlanId, AiAllowance> = {
  free: { questionsPerWindow: 20, windowHours: 5, questionsPerDay: 40, perMinute: 5, scansPerDay: 3, tokensPerMonth: 600_000 },
  pro: { questionsPerWindow: 50, windowHours: 5, questionsPerDay: 150, perMinute: 10, scansPerDay: 30, tokensPerMonth: 5_000_000 },
};

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
    name: "FinTrack Free",
    summary: "Everything you need to run your money day to day.",
    features: [
      "Manual transactions, accounts and wallets",
      "Monthly budgets with alerts",
      "Savings goals",
      "CSV import with preview and duplicate checks",
      "Core dashboard and basic analytics",
      "Finn, your money assistant: 20 messages every 5 hours",
      "Tell Finn what you spent and it is recorded, as often as you like",
      "Export and delete your data any time",
    ],
    prices: [{ currency: "INR", interval: "month", amountMinor: 0 }],
  },
  {
    id: "pro",
    name: "FinTrack One",
    summary: "More depth for people who want to look ahead.",
    features: [
      "Everything in Free",
      "Forecasting and what-if scenarios",
      "Finn, your money assistant: 50 messages every 5 hours, with charts",
      "Advanced analytics and downloadable reports",
      "Smart categorisation and larger imports",
      "Automation rules",
    ],
    prices: [
      { currency: "INR", interval: "month", amountMinor: 14900 },
      { currency: "INR", interval: "year", amountMinor: 119900 },
      // International (PayPal) prices.
      { currency: "USD", interval: "month", amountMinor: 299 },
      { currency: "USD", interval: "year", amountMinor: 2399 },
    ],
  },
];

export function priceFor(plan: Plan, interval: Interval, currency: Price["currency"] = "INR"): Price | undefined {
  return plan.prices.find((p) => p.interval === interval && p.currency === currency);
}

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id) ?? PLANS[0];
/** The name people see for a stored plan id. */
export const planName = (id: PlanId): string => planById(id).name;

/** "₹149" for a price, whole rupees when there is no fractional part. The one formatter for plan prices. */
export function formatPrice(price: Price): string {
  const major = price.amountMinor / 100;
  return new Intl.NumberFormat(price.currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency: price.currency,
    maximumFractionDigits: Number.isInteger(major) ? 0 : 2,
  }).format(major);
}
