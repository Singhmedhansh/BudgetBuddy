import { describe, expect, it } from "vitest";
import { localDate, occurredAtForDate } from "./period";

// Regression: a refund or expense dated "today" used midday, so it sorted below anything stamped later the same day.
describe("occurredAtForDate", () => {
  const tz = "Asia/Kolkata";
  const now = new Date("2026-11-13T13:30:00Z"); // 19:00 on 13 Nov in India

  it("uses the real instant for today, so same-day entries keep the order they were entered", () => {
    expect(occurredAtForDate(2026, 11, 13, tz, now).getTime()).toBe(now.getTime());
    const later = new Date(now.getTime() + 60_000);
    expect(occurredAtForDate(2026, 11, 13, tz, later).getTime()).toBeGreaterThan(occurredAtForDate(2026, 11, 13, tz, now).getTime());
  });

  it("uses midday local time for an earlier day and stays on that calendar day", () => {
    const d = occurredAtForDate(2026, 11, 10, tz, now);
    expect(localDate(d, tz)).toEqual({ year: 2026, month: 11, day: 10 });
    expect(d.toISOString()).toBe("2026-11-10T06:30:00.000Z"); // 12:00 IST
  });

  it("is timezone-aware at the day boundary", () => {
    const lateUtc = new Date("2026-11-12T20:00:00Z"); // already 13 Nov 01:30 in India
    expect(occurredAtForDate(2026, 11, 13, tz, lateUtc).getTime()).toBe(lateUtc.getTime());
    expect(localDate(occurredAtForDate(2026, 11, 12, tz, lateUtc), tz).day).toBe(12);
  });
});
