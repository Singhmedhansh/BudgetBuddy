import { cache } from "react";
import type { DateFormat } from "@/config/profile-options";

/**
 * The signed-in person's number and date formatting, held per request. The app shell sets it once after loading the
 * profile; Money and the date helpers read it, so a preference applies everywhere without threading it through every
 * component. Outside a request (tests, client bundles) it falls back to the original defaults.
 */
export interface FormatPrefs {
  numberLocale: string;
  dateFormat: DateFormat | null;
}
const DEFAULTS: FormatPrefs = { numberLocale: "en-IN", dateFormat: null };
const holder = cache((): FormatPrefs => ({ ...DEFAULTS }));

export function setFormatPrefs(p: Partial<FormatPrefs>): void {
  Object.assign(holder(), p);
}
export function getFormatPrefs(): FormatPrefs {
  return holder();
}

const DATE_LOCALE: Record<DateFormat, { locale: string; opts: Intl.DateTimeFormatOptions }> = {
  dmy: { locale: "en-IN", opts: { day: "numeric", month: "short", year: "numeric" } },
  mdy: { locale: "en-US", opts: { day: "numeric", month: "short", year: "numeric" } },
  ymd: { locale: "en-CA", opts: { day: "2-digit", month: "2-digit", year: "numeric" } },
};

/** Formats an instant in a timezone using the chosen date format (day first by default). */
export function formatInstant(date: Date, timeZone: string, format: DateFormat | null = getFormatPrefs().dateFormat): string {
  const { locale, opts } = DATE_LOCALE[format ?? "dmy"];
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(date);
}
