/**
 * Period boundaries are computed in the user's IANA timezone and returned as
 * UTC instants, so "this month" means the user's month, not the server's.
 * Ranges are half-open: [from, to).
 */

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall-clock time y-m-d 00:00 occurs in `timeZone`. */
export function startOfLocalDay(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  // Two passes handle zones whose offset changes (DST) between guess and result.
  let t = guess - zoneOffsetMs(new Date(guess), timeZone);
  t = guess - zoneOffsetMs(new Date(t), timeZone);
  return new Date(t);
}

export interface Range {
  from: Date;
  to: Date;
}

export function monthRange(year: number, month: number, timeZone: string): Range {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    from: startOfLocalDay(year, month, 1, timeZone),
    to: startOfLocalDay(nextYear, nextMonth, 1, timeZone),
  };
}

/** The calendar year/month/day an instant falls on in `timeZone`. */
export function localDate(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * The instant to store for a transaction the user dated by calendar day. Today uses the real instant, so
 * entries made the same day list in the order they were entered (a refund after its expense, and so on).
 * Any earlier day uses midday in the user's timezone, so it stays on that calendar day whatever the UTC date.
 */
export function occurredAtForDate(year: number, month: number, day: number, timeZone: string, now: Date = new Date()): Date {
  const t = localDate(now, timeZone);
  if (t.year === year && t.month === month && t.day === day) return now;
  return new Date(startOfLocalDay(year, month, day, timeZone).getTime() + 12 * 3600 * 1000);
}
