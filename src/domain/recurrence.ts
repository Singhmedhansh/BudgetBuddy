/**
 * Recurring schedules for bills, subscriptions and expected income. Dates are
 * calendar dates ("YYYY-MM-DD") in the user's own calendar, so there is no
 * timezone arithmetic here. A monthly schedule anchored on the 31st falls on the
 * last day of shorter months (it does not skip them or drift), and returns to
 * the 31st when the month has one.
 */
export type Frequency = "once" | "weekly" | "monthly" | "quarterly" | "yearly";

export interface Schedule {
  frequency: Frequency;
  /** The first due date; also the anchor day for monthly/quarterly/yearly. */
  firstDue: string;
  /** Inclusive last date a payment can fall on, if any. */
  endsOn?: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function parseDate(s: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) throw new Error(`Invalid date: ${s}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new Error(`Invalid date: ${s}`);
  return { y, m, d };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(s: string, n: number): string {
  const { y, m, d } = parseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function addMonths(anchor: { y: number; m: number; d: number }, months: number): string {
  const total = anchor.y * 12 + (anchor.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return toStr(y, m, Math.min(anchor.d, daysInMonth(y, m)));
}

/** The n-th due date (0-based) of a schedule, ignoring the end date. */
function nth(s: Schedule, n: number): string {
  const a = parseDate(s.firstDue);
  switch (s.frequency) {
    case "once":
      return s.firstDue;
    case "weekly":
      return addDays(s.firstDue, 7 * n);
    case "monthly":
      return addMonths(a, n);
    case "quarterly":
      return addMonths(a, 3 * n);
    case "yearly":
      return addMonths(a, 12 * n);
  }
}

/** Due dates in [from, to] inclusive, in order. */
export function occurrencesBetween(s: Schedule, from: string, to: string): string[] {
  if (from > to) return [];
  const out: string[] = [];
  const last = s.endsOn && s.endsOn < to ? s.endsOn : to;
  const limit = s.frequency === "once" ? 1 : 2000;
  for (let n = 0; n < limit; n++) {
    const due = nth(s, n);
    if (due > last) break;
    if (due >= from) out.push(due);
  }
  return out;
}

/** The first due date on or after `from`, or null if the schedule has finished. */
export function nextDue(s: Schedule, from: string): string | null {
  const limit = s.frequency === "once" ? 1 : 2000;
  for (let n = 0; n < limit; n++) {
    const due = nth(s, n);
    if (s.endsOn && due > s.endsOn) return null;
    if (due >= from) return due;
  }
  return null;
}

/** Cost of one schedule normalised to a month and a year, in minor units. */
export function monthlyEquivalent(amount: number, f: Frequency): number {
  switch (f) {
    case "once":
      return 0;
    case "weekly":
      return Math.round((amount * 52) / 12);
    case "monthly":
      return amount;
    case "quarterly":
      return Math.round(amount / 3);
    case "yearly":
      return Math.round(amount / 12);
  }
}

export function yearlyEquivalent(amount: number, f: Frequency): number {
  switch (f) {
    case "once":
      return amount;
    case "weekly":
      return amount * 52;
    case "monthly":
      return amount * 12;
    case "quarterly":
      return amount * 4;
    case "yearly":
      return amount;
  }
}

export type DueState = "paid" | "overdue" | "due_soon" | "upcoming";

/** Where a specific due date stands relative to today and what has been paid. */
export function dueState(due: string, today: string, paid: boolean, remindDays: number): DueState {
  if (paid) return "paid";
  if (due < today) return "overdue";
  if (due <= addDays(today, remindDays)) return "due_soon";
  return "upcoming";
}
