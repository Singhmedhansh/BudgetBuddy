/**
 * Budget calculations. Definitions (shown to users in the Budgets help):
 *
 *   allocated  - the limit set for the category this period (+ rollover in)
 *   actual     - posted expenses in the period, net of refunds
 *   committed  - pending/scheduled expenses not yet posted
 *   remaining  - allocated - actual - committed (can be negative)
 *   overBudget - max(0, actual + committed - allocated)
 *   forecast   - actual + the not-yet-posted recurring amount expected in-period
 *
 * Rollover: if enabled, unspent budget (allocated - actual, floored at zero)
 * carries into the next period's allocation. Overspend does not carry as a
 * negative unless `carryOverspend` is set. Periods are half-open [from, to) in
 * the user's timezone, so a transaction at the exact boundary instant belongs
 * to the later period.
 */

export interface BudgetInput {
  allocated: number;
  actual: number;
  committed?: number;
  /** Amounts expected to still post before period end (recurring/scheduled). */
  expectedRemaining?: number;
}

export interface BudgetStatus {
  allocated: number;
  actual: number;
  committed: number;
  remaining: number;
  overBudget: number;
  forecast: number;
  /** actual+committed as a fraction of allocated; null when nothing is allocated. */
  usedRatio: number | null;
}

export function budgetStatus(i: BudgetInput): BudgetStatus {
  const committed = i.committed ?? 0;
  const spent = i.actual + committed;
  return {
    allocated: i.allocated,
    actual: i.actual,
    committed,
    remaining: i.allocated - spent,
    overBudget: Math.max(0, spent - i.allocated),
    forecast: i.actual + (i.expectedRemaining ?? 0),
    usedRatio: i.allocated > 0 ? spent / i.allocated : null,
  };
}

export type AlertLevel = "ok" | "warning" | "over";

/** Thresholds are fractions, e.g. 0.8 warns at 80% used. */
export function alertLevel(status: BudgetStatus, warnAt = 0.8): AlertLevel {
  if (status.usedRatio === null) return status.actual + status.committed > 0 ? "over" : "ok";
  if (status.usedRatio > 1) return "over";
  if (status.usedRatio >= warnAt) return "warning";
  return "ok";
}

export function rolloverAmount(
  prev: { allocated: number; actual: number },
  opts: { enabled: boolean; carryOverspend?: boolean },
): number {
  if (!opts.enabled) return 0;
  const leftover = prev.allocated - prev.actual;
  return opts.carryOverspend ? leftover : Math.max(0, leftover);
}
