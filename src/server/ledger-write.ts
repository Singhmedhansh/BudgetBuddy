import type { Posting } from "@/domain/ledger";
import { assertBalanced } from "@/domain/ledger";
import type { createClient } from "@/lib/supabase/server";

type BudgetBuddyClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/**
 * Persists a domain Posting through the atomic `post_transaction` RPC. The
 * domain layer decides the entries (and is covered by tests); this only maps
 * ledger ids to the account/category columns and calls the database, which
 * enforces balance, space ownership and permissions again.
 */
export async function persistPosting(
  supabase: BudgetBuddyClient,
  args: {
    spaceId: string;
    posting: Posting;
    currency: string;
    accountIds: Set<string>;
    merchant?: string | null;
    description?: string | null;
    notes?: string | null;
    refundOf?: string;
    /** Idempotency key: the same key can post only once per space, so a double submit cannot double-record. */
    clientKey?: string;
  },
): Promise<{ id?: string; error?: string; duplicate?: boolean }> {
  const { posting } = args;
  assertBalanced(posting);
  const amount = Math.max(...posting.entries.map((e) => Math.abs(e.amount)));
  const entries = posting.entries.map((e) =>
    args.accountIds.has(e.accountId) ? { account_id: e.accountId, amount: e.amount } : { category_id: e.accountId, amount: e.amount },
  );
  const { data, error } = await supabase.rpc("post_transaction", {
    p_space: args.spaceId,
    p_type: posting.type,
    p_occurred_at: posting.occurredAt.toISOString(),
    p_currency: args.currency,
    p_amount: amount,
    p_entries: entries,
    p_merchant: args.merchant ?? null,
    p_description: args.description ?? null,
    p_notes: args.notes ?? null,
    p_external_id: args.clientKey ? `ui:${args.clientKey}` : null,
    p_refund_of: args.refundOf ?? null,
  });
  if (error) {
    // The key was already used: the first submission saved this transaction, so this one is a harmless repeat.
    if (args.clientKey && /duplicate key/i.test(error.message)) return { duplicate: true };
    return { error: friendlyDbError(error.message) };
  }
  return { id: data as string };
}

export function friendlyDbError(message: string): string {
  if (message.includes("refundable amount")) return "That refund is more than what is left to refund on the original expense.";
  if (message.includes("does not balance")) return "The entries do not balance. Nothing was saved.";
  if (message.includes("row-level security") || message.includes("permission denied"))
    return "You do not have permission to change this space.";
  if (message.includes("Reverse the refund")) return "This expense has a refund. Reverse the refund first, then reverse the expense.";
  if (message.includes("Entries can only be added")) return "That transaction can no longer be changed. Reverse it instead.";
  if (message.includes("already reversed")) return "This transaction was already reversed.";
  if (message.includes("withdrawal cannot be more")) return "You can only take out what is saved for this goal.";
  if (message.includes("transactions_one_reversal")) return "This transaction was already reversed.";
  if (message.includes("duplicate key")) return "That record already exists.";
  return "Something went wrong and nothing was saved. Try again.";
}
