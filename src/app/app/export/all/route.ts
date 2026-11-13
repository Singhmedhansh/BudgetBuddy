import { requireSpace } from "@/server/context";

/** A full export of everything in the current space as JSON. Free on every plan; RLS decides what the caller may see. */
export async function GET() {
  const ctx = await requireSpace();
  const s = ctx.space.id;
  const table = async (name: string, order = "created_at") => (await ctx.supabase.from(name).select("*").eq("space_id", s).order(order)).data ?? [];
  const [accounts, categories, budgets, allocations, goals, contributions, items, payments, debtTerms] = await Promise.all([
    table("accounts"),
    table("categories", "name"),
    table("budgets"),
    ctx.supabase.from("budget_allocations").select("*").eq("space_id", s).then((r) => r.data ?? []),
    table("savings_goals"),
    table("goal_contributions"),
    table("recurring_items"),
    table("recurring_payments"),
    ctx.supabase.from("debt_terms").select("*").eq("space_id", s).then((r) => r.data ?? []),
  ]);
  const { data: transactions } = await ctx.supabase
    .from("transactions")
    .select("*, ledger_entries(account_id, category_id, amount)")
    .eq("space_id", s)
    .order("occurred_at", { ascending: true })
    .limit(200000);

  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      format: "budget-buddy-export-v1",
      note: "Amounts are integers in minor units (for example paise). In ledger entries, positive is a debit and negative a credit.",
      space: { id: s, name: ctx.space.name, currency: ctx.space.currency, timezone: ctx.profile.timezone },
      accounts,
      categories,
      transactions: transactions ?? [],
      budgets,
      budgetAllocations: allocations,
      savingsGoals: goals,
      goalContributions: contributions,
      recurringItems: items,
      recurringPayments: payments,
      debtTerms,
    },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="budget-buddy-export.json"',
      "Cache-Control": "no-store",
    },
  });
}
