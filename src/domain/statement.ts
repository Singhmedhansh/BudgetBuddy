import { MoneyError, minorUnitExponent } from "./money";
import { parseDate } from "./recurrence";

/**
 * Turns the rows of a bank statement CSV into normalised, validated records.
 * Nothing here guesses silently: a row that cannot be understood is reported as
 * invalid with a reason, and ambiguous dates are resolved by an explicit option.
 */
export type DateOrder = "dmy" | "mdy";

export interface Mapping {
  date: number;
  description: number;
  /** Single signed amount column, or use debit/credit. */
  amount?: number;
  debit?: number;
  credit?: number;
  /** Positive amounts are money in (default) or money out. */
  positiveIs?: "in" | "out";
}

export interface ParsedRow {
  line: number;
  date: string; // YYYY-MM-DD
  description: string;
  /** Minor units; positive = money in, negative = money out. */
  amount: number;
}

export interface RowProblem {
  line: number;
  reason: string;
}

const HEADER_HINTS = {
  date: ["date", "txn date", "transaction date", "value date", "posting date", "posted"],
  description: ["description", "narration", "details", "particulars", "memo", "payee", "merchant", "remarks", "transaction details"],
  amount: ["amount", "transaction amount", "amt"],
  debit: ["debit", "withdrawal", "withdrawals", "dr", "paid out", "money out", "withdrawal amt"],
  credit: ["credit", "deposit", "deposits", "cr", "paid in", "money in", "deposit amt"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Finds the header row and a likely column mapping. Returns null if it cannot tell. */
export function detectMapping(rows: string[][]): { headerRow: number; mapping: Mapping } | null {
  for (let h = 0; h < Math.min(rows.length, 15); h++) {
    const names = rows[h].map(norm);
    const find = (hints: string[]) => names.findIndex((n) => hints.includes(n));
    const date = find(HEADER_HINTS.date);
    const description = find(HEADER_HINTS.description);
    const amount = find(HEADER_HINTS.amount);
    const debit = find(HEADER_HINTS.debit);
    const credit = find(HEADER_HINTS.credit);
    if (date >= 0 && description >= 0 && (amount >= 0 || (debit >= 0 && credit >= 0))) {
      return { headerRow: h, mapping: amount >= 0 ? { date, description, amount } : { date, description, debit, credit } };
    }
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseStatementDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{2,4})$/.exec(s))) {
    const mi = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase());
    if (mi < 0) return null;
    [d, m, y] = [Number(match[1]), mi + 1, Number(match[3])];
    if (y < 100) y += 2000;
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
    const [a, b] = [Number(match[1]), Number(match[2])];
    [d, m] = order === "dmy" ? [a, b] : [b, a];
    y = Number(match[3]);
    if (y < 100) y += 2000;
  } else return null;
  const out = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  try {
    parseDate(out);
    return out;
  } catch {
    return null;
  }
}

/** Parses "1,234.50", "(500.00)", "-500", "500 Dr", "₹ 1,200" into signed minor units. Strict about decimals. */
export function parseStatementAmount(raw: string, currency: string): number | null {
  let s = raw.trim();
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\s*(dr|debit)\.?$/i.test(s)) {
    negative = true;
    s = s.replace(/\s*(dr|debit)\.?$/i, "");
  } else if (/\s*(cr|credit)\.?$/i.test(s)) s = s.replace(/\s*(cr|credit)\.?$/i, "");
  s = s.replace(/[\p{Sc}\s]/gu, "").replace(/^[A-Za-z]{3}(?=[\d.-])/, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/,/g, "");
  const exp = minorUnitExponent(currency);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > exp) return null;
  const minor = Number(m[1] + frac.padEnd(exp, "0"));
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

export function parseStatementRows(
  rows: string[][],
  headerRow: number,
  mapping: Mapping,
  opts: { currency: string; dateOrder: DateOrder },
): { rows: ParsedRow[]; problems: RowProblem[] } {
  const out: ParsedRow[] = [];
  const problems: RowProblem[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const date = parseStatementDate(r[mapping.date] ?? "", opts.dateOrder);
    if (!date) {
      problems.push({ line, reason: `Could not read the date "${(r[mapping.date] ?? "").slice(0, 30)}".` });
      continue;
    }
    let amount: number | null;
    if (mapping.amount !== undefined) {
      amount = parseStatementAmount(r[mapping.amount] ?? "", opts.currency);
      if (amount !== null && mapping.positiveIs === "out") amount = -amount;
    } else {
      const debit = parseStatementAmount(r[mapping.debit!] ?? "", opts.currency);
      const credit = parseStatementAmount(r[mapping.credit!] ?? "", opts.currency);
      if ((r[mapping.debit!] ?? "").trim() !== "" && debit === null) amount = null;
      else if ((r[mapping.credit!] ?? "").trim() !== "" && credit === null) amount = null;
      else if (debit && credit) {
        problems.push({ line, reason: "Both a debit and a credit are filled in." });
        continue;
      } else amount = debit ? -Math.abs(debit) : credit ? Math.abs(credit) : 0;
    }
    if (amount === null) {
      problems.push({ line, reason: "Could not read the amount, or it has more decimals than the currency allows." });
      continue;
    }
    if (amount === 0) {
      problems.push({ line, reason: "The amount is zero." });
      continue;
    }
    const description = (r[mapping.description] ?? "").trim().replace(/\s+/g, " ");
    if (description === "") {
      problems.push({ line, reason: "The description is empty." });
      continue;
    }
    out.push({ line, date, description: description.slice(0, 200), amount });
  }
  return { rows: out, problems };
}

/**
 * A stable fingerprint for idempotent import. The n-th occurrence of an
 * identical (account, date, amount, description) in a file gets index n, so two
 * genuine identical purchases both import, while importing the same file again
 * reproduces the same fingerprints and is skipped.
 */
export function fingerprints(accountId: string, rows: ParsedRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = [accountId, r.date, r.amount, r.description.toLowerCase()].join("|");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

export { MoneyError };
