import { startOfLocalDay } from "@/domain/period";

/** The first instant after a calendar day in a timezone (the start of the next day, so month ends roll over correctly). */
const endOfLocalDay = (y: number, m: number, d: number, tz: string) => {
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return new Date(startOfLocalDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz).getTime() - 1);
};
import type { requireSpace } from "@/server/context";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

/** Account types whose statement balance is money you have (not money you owe), so it compares directly. */
export const BANK_LIKE = new Set(["savings", "current", "cash", "wallet"]);

/**
 * What FinTrack shows for an account at the end of a given day (the statement's last date), in minor units:
 * today's ledger balance minus everything recorded after that day. Null when the balance cannot be read.
 */
export async function balanceAsOf(ctx: Ctx, accountId: string, date: string): Promise<number | null> {
  const [y, m, d] = date.split("-").map(Number);
  const end = endOfLocalDay(y, m, d, ctx.profile.timezone).toISOString();
  const [{ data: bal }, { data: later }] = await Promise.all([
    ctx.supabase.from("account_balances").select("ledger_balance").eq("account_id", accountId).maybeSingle(),
    ctx.supabase.from("ledger_entries").select("amount, transactions!inner(occurred_at)").eq("account_id", accountId).gt("transactions.occurred_at", end),
  ]);
  if (!bal) return null;
  const after = ((later ?? []) as { amount: number }[]).reduce((s, e) => s + Number(e.amount), 0);
  return Number(bal.ledger_balance) - after;
}
