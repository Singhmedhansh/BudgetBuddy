import { addDays, parseDate } from "./recurrence";

/**
 * Savings goal arithmetic. Contributions are tracked amounts toward a target.
 * They are not ledger postings: recording one does not move money or change any
 * account balance, so it can never be counted as an expense.
 */
export interface GoalInput {
  target: number;
  /** Net of contributions and withdrawals. */
  saved: number;
  deadline?: string | null;
  today: string;
}

export interface GoalProgress {
  saved: number;
  remaining: number;
  ratio: number; // 0..1, capped at 1
  complete: boolean;
}

export function goalProgress(g: Pick<GoalInput, "target" | "saved">): GoalProgress {
  const saved = Math.max(0, g.saved);
  const remaining = Math.max(0, g.target - saved);
  return { saved, remaining, ratio: g.target > 0 ? Math.min(1, saved / g.target) : 0, complete: g.target > 0 && saved >= g.target };
}

/** Whole calendar months from today until the deadline, counting a partial month as one. */
export function monthsUntil(deadline: string, today: string): number {
  const a = parseDate(today);
  const b = parseDate(deadline);
  if (deadline <= today) return 0;
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d > a.d) months += 1;
  return Math.max(1, months);
}

/** What to set aside each month to finish by the deadline; null with no deadline or already complete. */
export function monthlyTarget(g: GoalInput): number | null {
  if (!g.deadline) return null;
  const { remaining, complete } = goalProgress(g);
  if (complete) return 0;
  if (g.deadline <= g.today) return remaining; // past due: all of it is outstanding
  return Math.ceil(remaining / monthsUntil(g.deadline, g.today));
}

/**
 * Estimated completion date at the pace of the last `windowDays` of contributions.
 * Returns null if there is no positive pace. This is an estimate, not a promise.
 */
export function completionEstimate(args: {
  target: number;
  saved: number;
  contributions: { date: string; amount: number }[];
  today: string;
  windowDays?: number;
}): string | null {
  const { remaining, complete } = goalProgress(args);
  if (complete) return args.today;
  const window = args.windowDays ?? 90;
  const since = addDays(args.today, -window);
  const recent = args.contributions.filter((c) => c.date > since && c.date <= args.today).reduce((s, c) => s + c.amount, 0);
  if (recent <= 0) return null;
  const perDay = recent / window;
  const days = Math.ceil(remaining / perDay);
  if (days > 365 * 50) return null;
  return addDays(args.today, days);
}

export type GoalHealth = "complete" | "on_track" | "behind" | "no_deadline";

/** On track if the pace implied by the monthly target has been met so far, else behind. */
export function goalHealth(g: GoalInput, estimate: string | null): GoalHealth {
  if (goalProgress(g).complete) return "complete";
  if (!g.deadline) return "no_deadline";
  if (estimate && estimate <= g.deadline) return "on_track";
  return "behind";
}

