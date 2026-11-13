/**
 * Double-entry ledger beneath the friendly transaction UI.
 *
 * Sign convention: an entry amount is signed minor units, positive = debit,
 * negative = credit. Every posting's entries sum to exactly zero.
 *
 * Ledger account kinds:
 *   asset     - cash, bank, wallet, investment (debit-normal)
 *   liability - credit card, loans (credit-normal; balance owed = -sum)
 *   expense   - spending categories (debit-normal)
 *   income    - income sources (credit-normal)
 *   equity    - opening balances and manual adjustments
 *
 * User-facing mapping (x = positive amount):
 *   expense    on A, category C : A -x, C +x
 *   income     into A, source S : A +x, S -x
 *   transfer   A -> B           : A -x, B +x   (never income or expense)
 *   refund     into A, cat C    : A +x, C -x   (reduces the original expense)
 *   adjustment A by +/-x        : A +/-x, equity -/+x
 *
 * Because a credit-card purchase is "card -x, category +x" and its repayment is
 * the transfer "bank -x, card +x", spending is counted once, at purchase.
 */

export type LedgerKind = "asset" | "liability" | "expense" | "income" | "equity";

export interface LedgerAccount {
  id: string;
  kind: LedgerKind;
  currency: string;
}

export interface Entry {
  accountId: string;
  amount: number;
}

export type TransactionType = "expense" | "income" | "transfer" | "refund" | "adjustment";
export type TransactionStatus = "posted" | "pending" | "reversed";

export interface Posting {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  /** UTC instant of the transaction. */
  occurredAt: Date;
  /** Set on refunds: the posting being refunded. */
  refundOf?: string;
  /** Set on reversals: the posting being reversed. */
  reversalOf?: string;
  entries: Entry[];
}

export class LedgerError extends Error {}

function positive(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new LedgerError("Amount must be a positive integer of minor units");
  }
}

export function expensePosting(
  p: { id: string; occurredAt: Date; amount: number; accountId: string; categoryId: string; status?: TransactionStatus },
): Posting {
  positive(p.amount);
  return {
    id: p.id,
    type: "expense",
    status: p.status ?? "posted",
    occurredAt: p.occurredAt,
    entries: [
      { accountId: p.accountId, amount: -p.amount },
      { accountId: p.categoryId, amount: p.amount },
    ],
  };
}

export function incomePosting(
  p: { id: string; occurredAt: Date; amount: number; accountId: string; sourceId: string; status?: TransactionStatus },
): Posting {
  positive(p.amount);
  return {
    id: p.id,
    type: "income",
    status: p.status ?? "posted",
    occurredAt: p.occurredAt,
    entries: [
      { accountId: p.accountId, amount: p.amount },
      { accountId: p.sourceId, amount: -p.amount },
    ],
  };
}

export function transferPosting(
  p: { id: string; occurredAt: Date; amount: number; fromAccountId: string; toAccountId: string },
): Posting {
  positive(p.amount);
  if (p.fromAccountId === p.toAccountId) throw new LedgerError("Cannot transfer to the same account");
  return {
    id: p.id,
    type: "transfer",
    status: "posted",
    occurredAt: p.occurredAt,
    entries: [
      { accountId: p.fromAccountId, amount: -p.amount },
      { accountId: p.toAccountId, amount: p.amount },
    ],
  };
}

export function adjustmentPosting(
  p: { id: string; occurredAt: Date; amount: number; accountId: string; equityId: string },
): Posting {
  if (!Number.isSafeInteger(p.amount) || p.amount === 0) throw new LedgerError("Adjustment must be a non-zero integer");
  return {
    id: p.id,
    type: "adjustment",
    status: "posted",
    occurredAt: p.occurredAt,
    entries: [
      { accountId: p.accountId, amount: p.amount },
      { accountId: p.equityId, amount: -p.amount },
    ],
  };
}

/**
 * Refund against an original expense. The refund must reuse the original's
 * category and may not exceed what is still refundable.
 */
export function refundPosting(
  p: { id: string; occurredAt: Date; amount: number; accountId: string },
  original: Posting,
  existing: Posting[],
): Posting {
  positive(p.amount);
  if (original.type !== "expense" || original.status !== "posted") {
    throw new LedgerError("Only a posted expense can be refunded");
  }
  const categoryEntry = original.entries.find((e) => e.amount > 0);
  if (!categoryEntry) throw new LedgerError("Original expense has no category entry");
  const originalAmount = categoryEntry.amount;
  const reversed = new Set(existing.filter((x) => x.reversalOf).map((x) => x.reversalOf));
  const alreadyRefunded = existing
    .filter((x) => x.type === "refund" && x.refundOf === original.id && x.status === "posted" && !reversed.has(x.id))
    .reduce((sum, x) => sum + (x.entries.find((e) => e.amount < 0)?.amount ?? 0) * -1, 0);
  if (alreadyRefunded + p.amount > originalAmount) {
    throw new LedgerError("Refund exceeds the refundable amount of the original expense");
  }
  return {
    id: p.id,
    type: "refund",
    status: "posted",
    occurredAt: p.occurredAt,
    refundOf: original.id,
    entries: [
      { accountId: p.accountId, amount: p.amount },
      { accountId: categoryEntry.accountId, amount: -p.amount },
    ],
  };
}

/**
 * Posted history is never edited. A reversal is a new posting with negated
 * entries that references the original, preserving the audit trail.
 */
export function reversePosting(original: Posting, id: string, occurredAt: Date): Posting {
  if (original.status !== "posted") throw new LedgerError("Only posted transactions can be reversed");
  return {
    id,
    type: original.type,
    status: "posted",
    occurredAt,
    reversalOf: original.id,
    entries: original.entries.map((e) => ({ accountId: e.accountId, amount: -e.amount })),
  };
}

export function isBalanced(p: Posting): boolean {
  return p.entries.reduce((s, e) => s + e.amount, 0) === 0;
}

export function assertBalanced(p: Posting): void {
  if (!isBalanced(p)) throw new LedgerError(`Posting ${p.id} does not balance`);
}

/**
 * Postings that affect balances: status "posted". A reversed transaction keeps
 * its original posting and gains an offsetting reversal posting, so both are
 * counted and net to zero while the full history stays auditable.
 */
function effective(postings: Posting[]): Posting[] {
  return postings.filter((p) => p.status === "posted");
}

/** Raw signed sum of entries for a ledger account (debit positive). */
export function ledgerBalance(accountId: string, postings: Posting[]): number {
  let sum = 0;
  for (const p of effective(postings)) {
    for (const e of p.entries) if (e.accountId === accountId) sum += e.amount;
  }
  return sum;
}

/**
 * User-facing balance. Assets show what you hold; liabilities show what you
 * owe as a positive number.
 */
export function accountBalance(account: LedgerAccount, postings: Posting[]): number {
  const raw = ledgerBalance(account.id, postings);
  // `raw === 0 ? 0` avoids returning -0 for a fully repaid liability.
  return account.kind === "liability" ? (raw === 0 ? 0 : -raw) : raw;
}

/** Net worth = assets - liabilities, over posted entries only. */
export function netWorth(accounts: LedgerAccount[], postings: Posting[]): number {
  let total = 0;
  for (const a of accounts) {
    if (a.kind === "asset") total += ledgerBalance(a.id, postings);
    else if (a.kind === "liability") total += ledgerBalance(a.id, postings); // credit-normal: raw is negative when owed
  }
  return total;
}

export interface PeriodTotals {
  income: number;
  expenses: number;
  net: number;
}

/**
 * Income and expense totals in [from, to). Transfers touch only asset and
 * liability accounts so they are excluded by construction; refunds net down the
 * expense category; pending and reversed-original postings are excluded.
 */
export function periodTotals(
  accounts: LedgerAccount[],
  postings: Posting[],
  from: Date,
  to: Date,
): PeriodTotals {
  const kind = new Map(accounts.map((a) => [a.id, a.kind]));
  let income = 0;
  let expenses = 0;
  for (const p of effective(postings)) {
    if (p.occurredAt < from || p.occurredAt >= to) continue;
    for (const e of p.entries) {
      const k = kind.get(e.accountId);
      if (k === "expense") expenses += e.amount;
      else if (k === "income") income += -e.amount;
    }
  }
  return { income, expenses, net: income - expenses };
}

/** Spending per expense-category ledger account in [from, to). */
export function spendingByCategory(
  accounts: LedgerAccount[],
  postings: Posting[],
  from: Date,
  to: Date,
): Map<string, number> {
  const kind = new Map(accounts.map((a) => [a.id, a.kind]));
  const out = new Map<string, number>();
  for (const p of effective(postings)) {
    if (p.occurredAt < from || p.occurredAt >= to) continue;
    for (const e of p.entries) {
      if (kind.get(e.accountId) === "expense") out.set(e.accountId, (out.get(e.accountId) ?? 0) + e.amount);
    }
  }
  return out;
}
