/** Pure helpers for the analytics screens. All amounts are integer minor units. */

/** Percentage change from previous to current; null when there is no meaningful base. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** The last `n` calendar months ending at (year, month), oldest first. */
export function monthsBack(year: number, month: number, n: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = year * 12 + (month - 1) - i;
    out.push({ year: Math.floor(t / 12), month: (t % 12) + 1 });
  }
  return out;
}

export interface Share {
  key: string;
  amount: number;
  /** Whole-number percentage of the total; shares sum to exactly 100 (largest remainder). */
  percent: number;
}

/** Share of the total for each positive amount, rounded so the percentages add to 100. */
export function shares(items: { key: string; amount: number }[]): Share[] {
  const positive = items.filter((i) => i.amount > 0);
  const total = positive.reduce((s, i) => s + i.amount, 0);
  if (total === 0) return [];
  const raw = positive.map((i) => ({ i, exact: (i.amount * 100) / total }));
  const floors = raw.map((r) => Math.floor(r.exact));
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, idx) => ({ idx, frac: r.exact - floors[idx] })).sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.idx] += 1;
    left -= 1;
  }
  return positive.map((i, idx) => ({ key: i.key, amount: i.amount, percent: floors[idx] })).sort((a, b) => b.amount - a.amount);
}

export interface MerchantTxn {
  id: string;
  type: string;
  merchant: string | null;
  /** Net effect on expense categories: positive for spending, negative for refunds and reversals of spending. */
  expenseAmount: number;
  reversalOf?: string | null;
  refundOf?: string | null;
}

/**
 * Net spending per merchant. A reversal or a refund is attributed to the
 * merchant of the transaction it offsets, so a reversed purchase nets to zero
 * instead of appearing as spending at a merchant called "Reversal".
 */
export function merchantTotals(txns: MerchantTxn[]): { merchant: string; amount: number; count: number }[] {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const totals = new Map<string, { amount: number; count: number }>();
  for (const t of txns) {
    if (t.expenseAmount === 0) continue;
    const origin = t.reversalOf ? byId.get(t.reversalOf) : t.refundOf ? byId.get(t.refundOf) : undefined;
    const name = (t.merchant ?? origin?.merchant ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const cur = totals.get(key) ?? { amount: 0, count: 0 };
    cur.amount += t.expenseAmount;
    if (!t.reversalOf && !t.refundOf) cur.count += 1;
    totals.set(key, cur);
  }
  const display = new Map<string, string>();
  for (const t of txns) if (t.merchant) display.set(t.merchant.toLowerCase(), display.get(t.merchant.toLowerCase()) ?? t.merchant);
  return [...totals.entries()]
    .filter(([, v]) => v.amount > 0)
    .map(([k, v]) => ({ merchant: display.get(k) ?? k, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant));
}
