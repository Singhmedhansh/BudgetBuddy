/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Independent ledger arithmetic: sums raw posted entries, bypassing the app's views and helpers. */
export async function ledgerBalances(sb: SupabaseClient<any, any, any>, spaceId: string) {
  const { data: accounts } = await sb.from("accounts").select("id,name,type").eq("space_id", spaceId);
  const { data: entries, error } = await sb.from("ledger_entries").select("account_id,amount,transactions!inner(status)").eq("space_id", spaceId).not("account_id", "is", null);
  if (error) throw error;
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
