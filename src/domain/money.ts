/**
 * Money is always an integer count of minor units (paise, cents, ...).
 * Floating point is never used for amounts. Strings from user input are
 * parsed with exact decimal arithmetic.
 */

/** ISO 4217 minor-unit exponents for the currencies Budget Buddy supports. */
const EXPONENTS: Record<string, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  AED: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
};

export type CurrencyCode = string;

export class MoneyError extends Error {}

export function minorUnitExponent(currency: CurrencyCode): number {
  const exp = EXPONENTS[currency.toUpperCase()];
  if (exp === undefined) throw new MoneyError(`Unsupported currency: ${currency}`);
  return exp;
}

export function isSupportedCurrency(currency: string): boolean {
  return currency.toUpperCase() in EXPONENTS;
}

/**
 * Parse a user-entered decimal string ("1,234.50", "-12.5") into minor units.
 * Rejects more fractional digits than the currency allows instead of rounding
 * silently, so the user never records an amount different from what they typed.
 */
export function parseAmount(input: string, currency: CurrencyCode): number {
  const exp = minorUnitExponent(currency);
  const cleaned = input.trim().replace(/,/g, "");
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) throw new MoneyError(`Invalid amount: "${input}"`);
  const [, sign, whole, frac = ""] = match;
  if (frac.length > exp) {
    throw new MoneyError(`${currency.toUpperCase()} allows at most ${exp} decimal places`);
  }
  const minor = Number(whole + frac.padEnd(exp, "0"));
  if (!Number.isSafeInteger(minor)) throw new MoneyError("Amount is too large");
  return sign ? -minor : minor;
}

/** Format minor units as a plain decimal string ("1234.50") without symbols. */
export function toDecimalString(minor: number, currency: CurrencyCode): string {
  assertInteger(minor);
  const exp = minorUnitExponent(currency);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, "0");
  const whole = exp === 0 ? digits : digits.slice(0, -exp);
  const frac = exp === 0 ? "" : "." + digits.slice(-exp);
  return (negative ? "-" : "") + whole + frac;
}

/** Locale-aware display, e.g. formatMoney(123456, "INR", "en-IN") -> "₹1,234.56". */
export function formatMoney(minor: number, currency: CurrencyCode, locale = "en-IN"): string {
  const exp = minorUnitExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(Number(toDecimalString(minor, currency)));
}

export function assertInteger(n: number): void {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`Amount must be a safe integer of minor units, got ${n}`);
}

/**
 * Split `total` into parts proportional to `weights` with no lost or created
 * minor units (largest-remainder method). Used for split transactions.
 */
export function allocate(total: number, weights: number[]): number[] {
  assertInteger(total);
  if (weights.length === 0 || weights.some((w) => !(w >= 0)) || weights.every((w) => w === 0)) {
    throw new MoneyError("Weights must be non-negative with at least one positive value");
  }
  if (weights.some((w) => !Number.isSafeInteger(w))) {
    throw new MoneyError("Weights must be integers");
  }
  // Exact integer arithmetic via BigInt: no floating-point rounding anywhere.
  const sign = total < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(total));
  const w = weights.map(BigInt);
  const weightSum = w.reduce((a, b) => a + b, 0n);
  const shares = w.map((x) => (abs * x) / weightSum);
  const rems = w.map((x, i) => (abs * x) % weightSum);
  let leftover = abs - shares.reduce((a, b) => a + b, 0n);
  const order = rems
    .map((r, i) => ({ i, r }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of order) {
    if (leftover === 0n) break;
    shares[i] += 1n;
    leftover -= 1n;
  }
  return shares.map((s) => Number(s) * sign);
}
