import type { Posting } from "@/domain/ledger";
import type { requireSpace } from "./context";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

export interface RefundContext {
  original: Posting;
  originalId: string;
  amount: number;
  /** What can still be refunded: the original amount minus active (non-reversed) refunds. */
  remaining: number;
  label: string;
  categoryName: string | null;
  accountId: string | null;
  existing: Posting[];
}

type Leg = { account_id: string | null; category_id: string | null; amount: number };
const toEntries = (legs: Leg[]) => legs.map((e) => ({ accountId: (e.account_id ?? e.category_id) as string, amount: Number(e.amount) }));

/** Loads an expense and everything needed to decide whether, and how much, can be refunded. Null when it cannot be refunded. */
export async function loadRefundContext(ctx: Ctx, id: string): Promise<RefundContext | null> {
  const { data: t } = await ctx.supabase
    .from("transactions")
    .select("id,type,status,occurred_at,amount,merchant,description,ledger_entries(account_id,category_id,amount)")
    .eq("space_id", ctx.space.id)
    .eq("id", id)
    .maybeSingle();
  if (!t || t.type !== "expense" || t.status !== "posted") return null;
  const { data: reversal } = await ctx.supabase.from("transactions").select("id").eq("reversal_of", id);
  if ((reversal ?? []).length > 0) return null; // a reversed expense has nothing left to refund

  const { data: refunds } = await ctx.supabase.from("transactions").select("id,amount,occurred_at,ledger_entries(account_id,category_id,amount)").eq("refund_of", id);
  const refundIds = (refunds ?? []).map((r) => r.id as string);
  const { data: reversedRefunds } = refundIds.length ? await ctx.supabase.from("transactions").select("reversal_of").in("reversal_of", refundIds) : { data: [] as { reversal_of: string }[] };
  const reversed = new Set((reversedRefunds ?? []).map((v) => v.reversal_of as string));

  const legs = t.ledger_entries as Leg[];
  const original: Posting = { id, type: "expense", status: "posted", occurredAt: new Date(t.occurred_at as string), entries: toEntries(legs) };
  const existing: Posting[] = [
    ...(refunds ?? []).map((r) => ({ id: r.id as string, type: "refund" as const, status: "posted" as const, occurredAt: new Date(r.occurred_at as string), refundOf: id, entries: toEntries(r.ledger_entries as Leg[]) })),
    ...[...reversed].map((rid) => ({ id: `reversal-of-${rid}`, type: "refund" as const, status: "posted" as const, occurredAt: new Date(), reversalOf: rid, entries: [] })),
  ];
  const refunded = (refunds ?? []).filter((r) => !reversed.has(r.id as string)).reduce((s, r) => s + Number(r.amount), 0);
  const catLeg = legs.find((e) => e.category_id);
  const acctLeg = legs.find((e) => e.account_id);
  const { data: cat } = catLeg?.category_id ? await ctx.supabase.from("categories").select("name").eq("id", catLeg.category_id).maybeSingle() : { data: null };
  return {
    original,
    originalId: id,
    amount: Number(t.amount),
    remaining: Number(t.amount) - refunded,
    label: (t.merchant as string | null) || (t.description as string | null) || "Expense",
    categoryName: (cat?.name as string | undefined) ?? null,
    accountId: acctLeg?.account_id ?? null,
    existing,
  };
}
