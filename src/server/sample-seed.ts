import { adjustmentPosting, expensePosting, incomePosting, transferPosting } from "@/domain/ledger";
import { localDate, occurredAtForDate } from "@/domain/period";
import { starterCategories } from "@/config/categories";
import type { getContext } from "./context";
import { friendlyDbError, persistPosting } from "./ledger-write";
import { buildSampleDataset, isSampleSpace, type AccountKey } from "./sample-data";
import { isLiability, type AccountType } from "./types";

type Ctx = Awaited<ReturnType<typeof getContext>>;

/**
 * Creates the fictional sample space for the signed-in person using their own session, so every row is protected by
 * the same access rules as real data and is visible to nobody else. Returns the new space id. If the person already
 * has a sample space it is returned instead of creating a second one.
 */
export async function seedSampleSpace(ctx: Ctx): Promise<{ spaceId?: string; error?: string }> {
  const { supabase, user, profile, spaces } = ctx;
  const existing = spaces.find((s) => isSampleSpace(s));
  if (existing) return { spaceId: existing.id };

  const today = localDate(new Date(), profile.timezone);
  const data = buildSampleDataset(today);
  const tz = profile.timezone;

  const { data: created, error } = await supabase.rpc("create_space", { p_name: data.spaceName, p_kind: "household", p_currency: "INR" });
  if (error) return { error: friendlyDbError(error.message) };
  const spaceId = (Array.isArray(created) ? created[0] : created).id as string;
  // Marks the space as sample so the app can label it and offer to remove it. Older databases lack the column: the name still says so.
  await supabase.from("financial_spaces").update({ is_sample: true }).eq("id", spaceId);

  const fail = (message: string) => ({ spaceId, error: `${message} The sample space was created but may be incomplete; you can remove it from Settings and try again.` });

  const { error: catErr } = await supabase.from("categories").insert(starterCategories("household").map((c) => ({ ...c, space_id: spaceId })));
  if (catErr) return fail(friendlyDbError(catErr.message));
  const { data: cats } = await supabase.from("categories").select("id,name,kind").eq("space_id", spaceId);
  const catId = (name: string, kind: "expense" | "income" | "equity") => cats?.find((c) => c.name === name && c.kind === kind)?.id as string | undefined;
  const opening = catId("Opening balance", "equity");
  if (!opening) return fail("The opening-balance category is missing.");

  const { data: accts, error: acctErr } = await supabase
    .from("accounts")
    .insert(data.accounts.map((a) => ({ space_id: spaceId, name: a.name, type: a.type, currency: "INR" })))
    .select("id,name");
  if (acctErr || !accts) return fail(friendlyDbError(acctErr?.message ?? ""));
  const acct = new Map<AccountKey, string>(data.accounts.map((a) => [a.key, accts.find((x) => x.name === a.name)!.id as string]));
  const accountIds = new Set(acct.values());
  const post = (posting: Parameters<typeof persistPosting>[1]["posting"], extra: { merchant?: string; description?: string; key: string }) =>
    persistPosting(supabase, { spaceId, posting, currency: "INR", accountIds, merchant: extra.merchant, description: extra.description, clientKey: `sample-${extra.key}` });

  // Opening balances first, in one batch.
  const openings = await Promise.all(
    data.accounts.map((a) => {
      const signed = isLiability(a.type as AccountType) ? -a.opening : a.opening;
      return post(adjustmentPosting({ id: "o", occurredAt: new Date(), amount: signed, accountId: acct.get(a.key)!, equityId: opening }), { description: "Opening balance", key: `open-${a.key}` });
    }),
  );
  const bad = openings.find((r) => r.error);
  if (bad) return fail(bad.error!);

  // Transactions in small parallel batches: each is its own atomic database call.
  for (let i = 0; i < data.transactions.length; i += 8) {
    const batch = data.transactions.slice(i, i + 8);
    const results = await Promise.all(
      batch.map((t, j) => {
        const occurredAt = occurredAtForDate(t.date.y, t.date.m, t.date.d, tz);
        const id = `t${i + j}`;
        const key = String(i + j);
        if (t.kind === "transfer") return post(transferPosting({ id, occurredAt, amount: t.amount, fromAccountId: acct.get(t.from)!, toAccountId: acct.get(t.to!)! }), { merchant: t.merchant, key });
        if (t.kind === "income") return post(incomePosting({ id, occurredAt, amount: t.amount, accountId: acct.get(t.from)!, sourceId: catId(t.category!, "income")! }), { merchant: t.merchant, key });
        return post(expensePosting({ id, occurredAt, amount: t.amount, accountId: acct.get(t.from)!, categoryId: catId(t.category!, "expense")! }), { merchant: t.merchant, key });
      }),
    );
    const err = results.find((r) => r.error);
    if (err) return fail(err.error!);
  }

  const startsOn = `${today.year}-${String(today.month).padStart(2, "0")}-01`;
  for (const b of data.budgets) {
    const { data: budget, error: bErr } = await supabase
      .from("budgets")
      .insert({ space_id: spaceId, name: b.name, period: "monthly", starts_on: startsOn, currency: "INR", rollover: false, warn_at: b.warnAt / 100, created_by: user.id })
      .select("id")
      .single();
    if (bErr || !budget) return fail(friendlyDbError(bErr?.message ?? ""));
    const { error: aErr } = await supabase.from("budget_allocations").insert(b.lines.map((l) => ({ budget_id: budget.id, space_id: spaceId, category_id: catId(l.category, "expense"), amount: l.amount })));
    if (aErr) return fail(friendlyDbError(aErr.message));
  }

  for (const g of data.goals) {
    const { data: goal, error: gErr } = await supabase
      .from("savings_goals")
      .insert({ space_id: spaceId, name: g.name, target_amount: g.target, currency: "INR", priority: 1, created_by: user.id })
      .select("id")
      .single();
    if (gErr || !goal) return fail(friendlyDbError(gErr?.message ?? ""));
    const { error: cErr } = await supabase
      .from("goal_contributions")
      .insert(g.contributions.map((c) => ({ goal_id: goal.id, space_id: spaceId, amount: c.amount, contributed_on: `${c.date.y}-${String(c.date.m).padStart(2, "0")}-${String(c.date.d).padStart(2, "0")}`, note: c.note, created_by: user.id })));
    if (cErr) return fail(friendlyDbError(cErr.message));
  }

  const { error: rErr } = await supabase.from("recurring_items").insert(
    data.recurring.map((r) => ({
      space_id: spaceId,
      kind: r.kind,
      name: r.name,
      amount: r.amount,
      currency: "INR",
      frequency: r.frequency,
      first_due: r.firstDue,
      account_id: acct.get(r.account),
      category_id: catId(r.category, r.kind === "income" ? "income" : "expense"),
      remind_days: 3,
      auto_renews: true,
      created_by: user.id,
    })),
  );
  if (rErr) return fail(friendlyDbError(rErr.message));
  return { spaceId };
}
