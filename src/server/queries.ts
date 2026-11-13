import type { Posting } from "@/domain/ledger";
import { budgetStatus, alertLevel, type BudgetStatus, type AlertLevel } from "@/domain/budget";
import { localDate, monthRange } from "@/domain/period";
import { requireSpace } from "./context";
import type { Account, Category, TransactionRow } from "./types";
import { isLiability } from "./types";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

export async function currentMonth(ctx: Pick<Ctx, "profile">) {
  const now = localDate(new Date(), ctx.profile.timezone);
  return { ...monthRange(now.year, now.month, ctx.profile.timezone), year: now.year, month: now.month };
}

export interface AccountWithBalance extends Account {
  /** User-facing: what you hold for assets, what you owe for liabilities. */
  balance: number;
}

export async function listAccounts(ctx: Ctx, includeArchived = false): Promise<AccountWithBalance[]> {
  const { data: accounts } = await ctx.supabase.from("accounts").select("*").eq("space_id", ctx.space.id).order("created_at");
  const { data: balances } = await ctx.supabase.from("account_balances").select("account_id,ledger_balance").eq("space_id", ctx.space.id);
  const raw = new Map((balances ?? []).map((b) => [b.account_id as string, Number(b.ledger_balance)]));
  return ((accounts ?? []) as Account[])
    .filter((a) => includeArchived || !a.archived_at)
    .map((a) => {
      const r = raw.get(a.id) ?? 0;
      return { ...a, balance: isLiability(a.type) ? (r === 0 ? 0 : -r) : r };
    });
}

export async function listCategories(ctx: Ctx, kind?: "expense" | "income"): Promise<Category[]> {
  let q = ctx.supabase.from("categories").select("*").eq("space_id", ctx.space.id).is("archived_at", null).order("name");
  q = kind ? q.eq("kind", kind) : q.neq("kind", "equity");
  const { data } = await q;
  return (data ?? []) as Category[];
}

export interface TxnListItem extends TransactionRow {
  categoryName: string | null;
  accountNames: string[];
  reversed: boolean;
}

export async function listTransactions(ctx: Ctx, opts: { type?: string; accountId?: string; q?: string; limit?: number } = {}): Promise<TxnListItem[]> {
  let q = ctx.supabase
    .from("transactions")
    .select("*, ledger_entries(account_id, category_id, amount)")
    .eq("space_id", ctx.space.id)
    .order("occurred_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.type) q = q.eq("type", opts.type);
  if (opts.q) q = q.or(`merchant.ilike.%${opts.q.replace(/[%,()]/g, " ")}%,description.ilike.%${opts.q.replace(/[%,()]/g, " ")}%`);
  const { data } = await q;
  const rows = (data ?? []) as (TransactionRow & { ledger_entries: { account_id: string | null; category_id: string | null; amount: number }[] })[];

  const [accounts, categories, reversals] = await Promise.all([
    listAccounts(ctx, true),
    ctx.supabase.from("categories").select("id,name").eq("space_id", ctx.space.id),
    ctx.supabase.from("transactions").select("reversal_of").eq("space_id", ctx.space.id).not("reversal_of", "is", null),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryName = new Map((categories.data ?? []).map((c) => [c.id as string, c.name as string]));
  const reversedIds = new Set((reversals.data ?? []).map((r) => r.reversal_of as string));

  return rows
    .filter((r) => !opts.accountId || r.ledger_entries.some((e) => e.account_id === opts.accountId))
    .map((r) => ({
      ...r,
      categoryName: r.ledger_entries.map((e) => (e.category_id ? categoryName.get(e.category_id) : undefined)).find(Boolean) ?? null,
      accountNames: r.ledger_entries.map((e) => (e.account_id ? accountName.get(e.account_id) : undefined)).filter((n): n is string => !!n),
      reversed: reversedIds.has(r.id),
    }));
}

/** Postings reconstructed from stored entries, for period totals via the domain layer. */
export async function postingsInRange(ctx: Ctx, from: Date, to: Date): Promise<{ postings: Posting[]; kinds: Map<string, "asset" | "liability" | "expense" | "income" | "equity"> }> {
  const [{ data: txns }, accounts, cats] = await Promise.all([
    ctx.supabase
      .from("transactions")
      .select("id,type,status,occurred_at,reversal_of,refund_of,ledger_entries(account_id,category_id,amount)")
      .eq("space_id", ctx.space.id)
      .gte("occurred_at", from.toISOString())
      .lt("occurred_at", to.toISOString()),
    listAccounts(ctx, true),
    ctx.supabase.from("categories").select("id,kind").eq("space_id", ctx.space.id),
  ]);
  const kinds = new Map<string, "asset" | "liability" | "expense" | "income" | "equity">();
  accounts.forEach((a) => kinds.set(a.id, isLiability(a.type) ? "liability" : "asset"));
  (cats.data ?? []).forEach((c) => kinds.set(c.id as string, c.kind as "expense" | "income" | "equity"));
  const postings: Posting[] = (txns ?? []).map((t) => ({
    id: t.id as string,
    type: t.type as Posting["type"],
    status: t.status as Posting["status"],
    occurredAt: new Date(t.occurred_at as string),
    reversalOf: (t.reversal_of as string | null) ?? undefined,
    refundOf: (t.refund_of as string | null) ?? undefined,
    entries: ((t.ledger_entries ?? []) as { account_id: string | null; category_id: string | null; amount: number }[]).map((e) => ({
      accountId: (e.account_id ?? e.category_id) as string,
      amount: Number(e.amount),
    })),
  }));
  return { postings, kinds };
}

export interface BudgetView {
  id: string;
  name: string;
  warnAt: number;
  rollover: boolean;
  lines: { categoryId: string; categoryName: string; status: BudgetStatus; level: AlertLevel }[];
  total: BudgetStatus;
}

export async function listBudgets(ctx: Ctx): Promise<BudgetView[]> {
  const month = await currentMonth(ctx);
  const [{ data: budgets }, { data: allocs }, cats] = await Promise.all([
    ctx.supabase.from("budgets").select("id,name,warn_at,rollover").eq("space_id", ctx.space.id).is("archived_at", null).order("created_at"),
    ctx.supabase.from("budget_allocations").select("budget_id,category_id,amount").eq("space_id", ctx.space.id),
    listCategories(ctx),
  ]);
  const { data: entries } = await ctx.supabase
    .from("ledger_entries")
    .select("category_id, amount, transactions!inner(occurred_at,status)")
    .eq("space_id", ctx.space.id)
    .not("category_id", "is", null)
    .eq("transactions.status", "posted")
    .gte("transactions.occurred_at", month.from.toISOString())
    .lt("transactions.occurred_at", month.to.toISOString());
  const spent = new Map<string, number>();
  for (const e of entries ?? []) spent.set(e.category_id as string, (spent.get(e.category_id as string) ?? 0) + Number(e.amount));
  const name = new Map(cats.map((c) => [c.id, c.name]));

  return (budgets ?? []).map((b) => {
    const mine = (allocs ?? []).filter((a) => a.budget_id === b.id);
    const lines = mine.map((a) => {
      const status = budgetStatus({ allocated: Number(a.amount), actual: spent.get(a.category_id as string) ?? 0 });
      return { categoryId: a.category_id as string, categoryName: name.get(a.category_id as string) ?? "Category", status, level: alertLevel(status, Number(b.warn_at)) };
    });
    const total = budgetStatus({
      allocated: lines.reduce((s, l) => s + l.status.allocated, 0),
      actual: lines.reduce((s, l) => s + l.status.actual, 0),
    });
    return { id: b.id as string, name: b.name as string, warnAt: Number(b.warn_at), rollover: Boolean(b.rollover), lines, total };
  });
}
