import { addDays } from "./recurrence";

/**
 * Cash-flow projection. Three kinds of numbers are kept apart:
 *   actual    - the starting balance (what you have recorded today)
 *   scheduled - bills, subscriptions, expected income and debt payments with dates
 *   forecast  - an estimate of everyday spending from your recent history
 * The result is an estimate built on stated assumptions, never a guarantee.
 */
export interface ScheduledEvent {
  date: string;
  /** Signed minor units: positive = money in, negative = money out. */
  amount: number;
  label: string;
  nature: "scheduled" | "estimate";
}

export interface ForecastInput {
  today: string;
  days: number;
  startBalance: number;
  events: ScheduledEvent[];
  /** Average everyday spending per day, minor units (positive number). */
  dailySpend: number;
  /** What-if: change everyday spending by this percentage (e.g. -10 or 25). */
  spendChangePct?: number;
  /** What-if: one-off amounts on specific dates (signed). */
  oneOffs?: { date: string; amount: number; label?: string }[];
}

export interface ForecastPoint {
  date: string;
  balance: number;
}

export interface ForecastResult {
  points: ForecastPoint[];
  endBalance: number;
  lowest: ForecastPoint;
  /** First date the projected balance goes below zero, if any. */
  firstNegative: string | null;
  scheduledIn: number;
  scheduledOut: number;
  variableSpend: number;
  dailyVariable: number;
}

export function forecast(input: ForecastInput): ForecastResult {
  const pct = input.spendChangePct ?? 0;
  const dailyVariable = Math.max(0, Math.round((input.dailySpend * (100 + pct)) / 100));
  const end = addDays(input.today, input.days);
  const byDate = new Map<string, number>();
  let scheduledIn = 0;
  let scheduledOut = 0;
  const add = (date: string, amount: number) => {
    // Anything already due (on or before today) is expected on the next day.
    const d = date <= input.today ? addDays(input.today, 1) : date;
    if (d > end) return;
    byDate.set(d, (byDate.get(d) ?? 0) + amount);
    if (amount >= 0) scheduledIn += amount;
    else scheduledOut += -amount;
  };
  for (const e of input.events) add(e.date, e.amount);
  for (const o of input.oneOffs ?? []) add(o.date, o.amount);

  const points: ForecastPoint[] = [{ date: input.today, balance: input.startBalance }];
  let balance = input.startBalance;
  let variableSpend = 0;
  let firstNegative: string | null = input.startBalance < 0 ? input.today : null;
  let lowest = points[0];
  for (let i = 1; i <= input.days; i++) {
    const date = addDays(input.today, i);
    balance += (byDate.get(date) ?? 0) - dailyVariable;
    variableSpend += dailyVariable;
    points.push({ date, balance });
    if (balance < lowest.balance) lowest = { date, balance };
    if (balance < 0 && firstNegative === null) firstNegative = date;
  }
  return { points, endBalance: balance, lowest, firstNegative, scheduledIn, scheduledOut, variableSpend, dailyVariable };
}

export type Confidence = "low" | "medium" | "high";

/**
 * Everyday spending per day from recent history, excluding spending that came
 * from recurring items (those are projected separately as scheduled events).
 */
export function baselineDailySpend(args: {
  spendTotal: number;
  recurringSettledTotal: number;
  /** Days of history available, at most the window the totals cover. */
  historyDays: number;
}): { perDay: number; confidence: Confidence; basisDays: number } {
  const basisDays = Math.max(1, Math.min(60, args.historyDays));
  const variable = Math.max(0, args.spendTotal - args.recurringSettledTotal);
  const confidence: Confidence = args.historyDays < 14 ? "low" : args.historyDays < 45 ? "medium" : "high";
  return { perDay: Math.round(variable / basisDays), confidence, basisDays };
}

/** Days until a balance runs out at a steady daily spend; null if it does not. */
export function daysOfCover(balance: number, dailySpend: number): number | null {
  if (dailySpend <= 0 || balance <= 0) return balance <= 0 && dailySpend > 0 ? 0 : null;
  return Math.floor(balance / dailySpend);
}
