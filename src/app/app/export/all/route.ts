import { requireSpace } from "@/server/context";
import { fetchAll } from "@/server/paging";

/** A full export of everything in the current space as JSON. Free on every plan; RLS decides what the caller may see. */
export async function GET() {
  const ctx = await requireSpace();
  const s = ctx.space.id;
  // Every row, a page at a time: PostgREST silently stops at 1000, which would make this backup incomplete.
  // `order` must end with a unique key so pages never repeat or skip rows.
  const table = (name: string, order: string[] = ["created_at", "id"]) =>
    fetchAll<Record<string, unknown>>((f, t) => order.reduce((q, col) => q.order(col), ctx.supabase.from(name).select("*").eq("space_id", s)).range(f, t));
  const [accounts, categories, budgets, allocations, goals, contributions, items, payments, debtTerms] = await Promise.all([
    table("accounts"),
    table("categories", ["name", "id"]),
    table("budgets"),
    table("budget_allocations", ["budget_id", "category_id"]),
    table("savings_goals"),
    table("goal_contributions"),
    table("recurring_items"),
    table("recurring_payments"),
    table("debt_terms", ["account_id"]),
  ]);
  const transactions = await fetchAll<Record<string, unknown>>((f, t) =>
    ctx.supabase.from("transactions").select("*, ledger_entries(account_id, category_id, amount)").eq("space_id", s).order("occurred_at", { ascending: true }).order("id").range(f, t),
  );

  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      format: "fintrack-export-v1",
      note: "Amounts are integers in minor units (for example paise). In ledger entries, positive is a debit and negative a credit.",
      space: { id: s, name: ctx.space.name, currency: ctx.space.currency, timezone: ctx.profile.timezone },
      accounts,
      categories,
      transactions,
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
      "Content-Disposition": 'attachment; filename="fintrack-export.json"',
      "Cache-Control": "no-store",
    },
  });
}
