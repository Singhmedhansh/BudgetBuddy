import type { TransactionType } from "./ledger";

/**
 * The signed amount to show for a transaction row, from the user's point of
 * view: money out is negative, money in is positive. A reversal offsets its
 * original, so it carries the opposite sign (reversing a spend shows as money
 * back, reversing income shows as money out). Transfers are neutral: they are
 * shown unsigned because they move money between the user's own accounts.
 */
export function displayAmount(t: { type: TransactionType; amount: number; isReversal?: boolean }): number {
  const flip = t.isReversal ? -1 : 1;
  switch (t.type) {
    case "expense":
      return -t.amount * flip;
    case "income":
    case "refund":
      return t.amount * flip;
    default:
      return t.amount;
  }
}
