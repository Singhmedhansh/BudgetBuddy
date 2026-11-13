/**
 * Debt payoff planning. Everything here is an informational projection from the
 * balances, rates and payments the user entered. It is not a lender-confirmed
 * figure and ignores fees, changing rates and how a lender applies payments.
 *
 * Interest accrues monthly at (annual rate / 12) on the opening balance of each
 * month, using exact integer arithmetic (BigInt) rounded half up to a minor unit.
 */
export interface Debt {
  id: string;
  name: string;
  /** Amount currently owed, minor units. */
  balance: number;
  /** Annual interest rate in basis points (1250 = 12.5%). */
  rateBps: number;
  /** Minimum payment per month, minor units. */
  minPayment: number;
}

export type Strategy = "avalanche" | "snowball";

export interface PayoffResult {
  strategy: Strategy;
  months: number;
  totalInterest: number;
  totalPaid: number;
  /** Month number (1-based) in which each debt reaches zero. */
  payoffMonth: Record<string, number>;
  /** Payoff order of debt ids. */
  order: string[];
  /** False if the budget cannot cover interest, so balances never reach zero. */
  feasible: boolean;
}

export function monthlyInterest(balance: number, rateBps: number): number {
  if (balance <= 0 || rateBps <= 0) return 0;
  const num = BigInt(balance) * BigInt(rateBps);
  const den = 120_000n; // 12 months * 10_000 bps
  return Number((num * 2n + den) / (den * 2n)); // round half up
}

const MAX_MONTHS = 1200;

/**
 * Simulate paying all debts with `monthlyBudget` in total each month. Every debt
 * gets at least its minimum (capped at what it owes); the remainder goes to the
 * target debt chosen by the strategy: highest rate first (avalanche) or smallest
 * balance first (snowball). Freed-up minimums roll into the remainder.
 */
export function simulatePayoff(debts: Debt[], monthlyBudget: number, strategy: Strategy): PayoffResult {
  const active = debts.filter((d) => d.balance > 0).map((d) => ({ ...d }));
  const payoffMonth: Record<string, number> = {};
  const order: string[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  const minimums = active.reduce((s, d) => s + d.minPayment, 0);
  if (active.length === 0) return { strategy, months: 0, totalInterest: 0, totalPaid: 0, payoffMonth, order, feasible: true };
  if (monthlyBudget < minimums) return { strategy, months: 0, totalInterest: 0, totalPaid: 0, payoffMonth, order, feasible: false };

  while (active.some((d) => d.balance > 0) && month < MAX_MONTHS) {
    month++;
    for (const d of active) {
      if (d.balance <= 0) continue;
      const interest = monthlyInterest(d.balance, d.rateBps);
      d.balance += interest;
      totalInterest += interest;
    }
    let pool = monthlyBudget;
    for (const d of active) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.minPayment, d.balance, pool);
      d.balance -= pay;
      pool -= pay;
      totalPaid += pay;
    }
    const targets = active
      .filter((d) => d.balance > 0)
      .sort((a, b) =>
        strategy === "avalanche" ? b.rateBps - a.rateBps || a.balance - b.balance : a.balance - b.balance || b.rateBps - a.rateBps,
      );
    for (const t of targets) {
      if (pool <= 0) break;
      const pay = Math.min(pool, t.balance);
      t.balance -= pay;
      pool -= pay;
      totalPaid += pay;
    }
    for (const d of active) {
      if (d.balance <= 0 && payoffMonth[d.id] === undefined) {
        payoffMonth[d.id] = month;
        order.push(d.id);
      }
    }
  }
  const feasible = !active.some((d) => d.balance > 0);
  return { strategy, months: month, totalInterest, totalPaid, payoffMonth, order, feasible };
}
