import { describe, expect, it } from "vitest";
import { formatMoney } from "@/domain/money";
import { formatInstant } from "./format-prefs";

const d = new Date(Date.UTC(2026, 10, 13, 12, 0, 0));

describe("date format preference", () => {
  it("day first is the default and matches the original display", () => {
    expect(formatInstant(d, "UTC", null)).toBe("13 Nov 2026");
    expect(formatInstant(d, "UTC", "dmy")).toBe("13 Nov 2026");
  });
  it("month first and year first", () => {
    expect(formatInstant(d, "UTC", "mdy")).toBe("Nov 13, 2026");
    expect(formatInstant(d, "UTC", "ymd")).toBe("2026-11-13");
  });
  it("respects the timezone at the day boundary", () => {
    const late = new Date(Date.UTC(2026, 10, 12, 20, 0, 0));
    expect(formatInstant(late, "Asia/Kolkata", "ymd")).toBe("2026-11-13");
    expect(formatInstant(late, "America/New_York", "ymd")).toBe("2026-11-12");
  });
});

describe("number format preference", () => {
  const normalise = (s: string) => s.replace(/[  ]/g, " ");
  it("changes grouping and decimal separators without changing the amount", () => {
    expect(formatMoney(12345678, "INR", "en-IN")).toContain("1,23,456.78");
    expect(formatMoney(12345678, "USD", "en-US")).toContain("123,456.78");
    expect(normalise(formatMoney(12345678, "EUR", "de-DE"))).toContain("123.456,78");
    expect(normalise(formatMoney(12345678, "EUR", "fr-FR"))).toContain("123 456,78");
  });
});
