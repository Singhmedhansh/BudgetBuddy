/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Independent ledger arithmetic: sums raw posted entries, bypassing the app's views and helpers. */
export async function ledgerBalances(sb: SupabaseClient<any, any, any>, spaceId: string) {
  const { data: accounts } = await sb.from("accounts").select("id,name,type").eq("space_id", spaceId);
  // PostgREST returns at most 1000 rows per request, and the disposable test user's ledger grows with every run. Read it
  // all, in a stable order, or the sums silently miss entries (that made this check flaky as the data accumulated).
  const entries: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("ledger_entries").select("account_id,amount,transactions!inner(status)").eq("space_id", spaceId).not("account_id", "is", null).order("id").range(from, from + 999);
    if (error) throw error;
    entries.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const sum = new Map<string, number>();
  for (const e of entries as unknown as { account_id: string; amount: number | string; transactions: { status: string } }[]) {
    if (e.transactions.status !== "posted") continue;
    sum.set(e.account_id, (sum.get(e.account_id) ?? 0) + Number(e.amount));
  }
  const out = new Map<string, { id: string; raw: number; liability: boolean }>();
  for (const a of accounts ?? []) out.set(a.name as string, { id: a.id as string, raw: sum.get(a.id as string) ?? 0, liability: ["credit_card", "other_liability"].includes(a.type as string) });
  return out;
}

export async function spaceId(sb: SupabaseClient<any, any, any>) {
  const { data } = await sb.from("financial_spaces").select("id").order("created_at").limit(1).single();
  return data!.id as string;
}
