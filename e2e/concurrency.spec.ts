import { expect, test } from "@playwright/test";
import { api } from "./helpers";

/** Real concurrent requests against the live database: the guards in migration 10 must hold under a race. */
test("two simultaneous reversals of one expense produce exactly one reversal", async () => {
  const sb = await api();
  const { data: sp } = await sb.from("financial_spaces").select("id").order("created_at").limit(1).single();
  const space = sp!.id as string;
  const stamp = Date.now().toString(36);
  const acct = (await sb.from("accounts").insert({ space_id: space, name: `E2E Race ${stamp}`, type: "current", currency: "INR" }).select("id").single()).data!.id as string;
  const cat = (await sb.from("categories").select("id").eq("space_id", space).eq("kind", "expense").limit(1).single()).data!.id as string;
  const { data: txn, error } = await sb.rpc("post_transaction", { p_space: space, p_type: "expense", p_occurred_at: new Date().toISOString(), p_currency: "INR", p_amount: 1000, p_entries: [{ account_id: acct, amount: -1000 }, { category_id: cat, amount: 1000 }], p_merchant: `race ${stamp}` });
  expect(error).toBeNull();

  const results = await Promise.all([1, 2, 3, 4].map(() => sb.rpc("reverse_transaction", { p_txn: txn })));
  expect(results.filter((r) => !r.error)).toHaveLength(1);
  const { count } = await sb.from("transactions").select("id", { count: "exact", head: true }).eq("reversal_of", txn as string);
  expect(count).toBe(1);
});

test("simultaneous refunds cannot together exceed the expense", async () => {
  const sb = await api();
  const { data: sp } = await sb.from("financial_spaces").select("id").order("created_at").limit(1).single();
  const space = sp!.id as string;
  const stamp = Date.now().toString(36);
  const acct = (await sb.from("accounts").insert({ space_id: space, name: `E2E Race R ${stamp}`, type: "current", currency: "INR" }).select("id").single()).data!.id as string;
  const cat = (await sb.from("categories").select("id").eq("space_id", space).eq("kind", "expense").limit(1).single()).data!.id as string;
  const post = (type: string, amt: number, sign: number, extra = {}) =>
    sb.rpc("post_transaction", { p_space: space, p_type: type, p_occurred_at: new Date().toISOString(), p_currency: "INR", p_amount: amt, p_entries: [{ account_id: acct, amount: sign * amt }, { category_id: cat, amount: -sign * amt }], p_merchant: `race ${stamp}`, ...extra });
  const { data: exp } = await post("expense", 1000, -1);

  const refunds = await Promise.all([1, 2, 3, 4].map(() => post("refund", 400, 1, { p_refund_of: exp })));
  expect(refunds.filter((r) => !r.error).length).toBeLessThanOrEqual(2); // 400 + 400 fits in 1,000; a third never does
  const { data: rows } = await sb.from("transactions").select("amount").eq("refund_of", exp as string).eq("status", "posted");
  expect((rows ?? []).reduce((t, r) => t + Number(r.amount), 0)).toBeLessThanOrEqual(1000);
});

test("simultaneous withdrawals cannot take a goal below zero", async () => {
  const sb = await api();
  const { data: sp } = await sb.from("financial_spaces").select("id").order("created_at").limit(1).single();
  const space = sp!.id as string;
  const { data: g } = await sb.from("savings_goals").insert({ space_id: space, name: `E2E Race goal ${Date.now().toString(36)}`, target_amount: 100000, currency: "INR", priority: 2, created_by: (await sb.auth.getUser()).data.user!.id }).select("id").single();
  const uid = (await sb.auth.getUser()).data.user!.id;
  const add = (amount: number) => sb.from("goal_contributions").insert({ goal_id: g!.id, space_id: space, amount, contributed_on: new Date().toISOString().slice(0, 10), created_by: uid });
  expect((await add(1000)).error).toBeNull();
  const out = await Promise.all([1, 2, 3, 4].map(() => add(-600)));
  expect(out.filter((r) => !r.error)).toHaveLength(1);
  const { data: rows } = await sb.from("goal_contributions").select("amount").eq("goal_id", g!.id);
  expect((rows ?? []).reduce((t, r) => t + Number(r.amount), 0)).toBe(400);
});
