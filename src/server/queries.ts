import type { Posting } from "@/domain/ledger";
import { budgetStatus, alertLevel, carriedIn, type BudgetStatus, type AlertLevel } from "@/domain/budget";
import { localDate, monthRange } from "@/domain/period";
import { nameMatches } from "@/lib/text";
import { requireSpace } from "./context";
import type { Account, Category, TransactionRow } from "./types";
import { isLiability } from "./types";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

export async function currentMonth(ctx: Pick<Ctx, "profile">) {
  const now = localDate(new Date(), ctx.profile.timezone);
  return { ...monthRange(now.year, now.month, ctx.profile.timezone), year: now.year, month: now.month };
}

/**
 * Request-scoped memo. One page render asks for the same accounts, balances and categories from several helpers
 * (analytics alone used to fetch them a dozen times). The cache is keyed on the per-request Supabase client, so it
 * lives exactly as long as one request, is never shared between users, and is gone before any later read. Only read
 * paths use it; mutations go through server actions, which build a fresh client.
 */
const memos = new WeakMap<object, Map<string, Promise<unknown>>>();
function memo<T>(ctx: Ctx, key: string, load: () => PromiseLike<T>): Promise<T> {
  let m = memos.get(ctx.supabase);
  if (!m) memos.set(ctx.supabase, (m = new Map()));
  const k = `${ctx.space.id}:${key}`;
  let p = m.get(k);
  if (!p) m.set(k, (p = Promise.resolve(load())));
  return p as Promise<T>;
}
const allCategories = (ctx: Ctx) => memo(ctx, "categories", () => ctx.supabase.from("categories").select("*").eq("space_id", ctx.space.id).order("name"));
const allReversals = (ctx: Ctx) => memo(ctx, "reversals", () => ctx.supabase.from("transactions").select("reversal_of").eq("space_id", ctx.space.id).not("reversal_of", "is", null));

export interface AccountWithBalance extends Account {
  /** User-facing: what you hold for assets, what you owe for liabilities. */
  balance: number;
}

export async function listAccounts(ctx: Ctx, includeArchived = false): Promise<AccountWithBalance[]> {
  const [{ data: accounts }, { data: balances }] = await memo(ctx, "accounts", () =>
    Promise.all([
      ctx.supabase.from("accounts").select("*").eq("space_id", ctx.space.id).order("created_at"),
      ctx.supabase.from("account_balances").select("account_id,ledger_balance").eq("space_id", ctx.space.id),
    ]),
  );
  const raw = new Map((balances ?? []).map((b) => [b.account_id as string, Number(b.ledger_balance)]));
  return ((accounts ?? []) as Account[])
    .filter((a) => includeArchived || !a.archived_at)
    .map((a) => {
      const r = raw.get(a.id) ?? 0;
      return { ...a, balance: isLiability(a.type) ? (r === 0 ? 0 : -r) : r };
    });
}

export async function listCategories(ctx: Ctx, kind?: "expense" | "income"): Promise<Category[]> {
  const { data } = await allCategories(ctx);
  return ((data ?? []) as Category[]).filter((c) => !c.archived_at && (kind ? c.kind === kind : c.kind !== "equity"));
}

export interface TxnListItem extends TransactionRow {
  categoryName: string | null;
  accountNames: string[];
  reversed: boolean;
  /** Net effect on expense categories (positive = spending). Reversals and refunds are negative. */
  expenseAmount: number;
}

export type TxnSort = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
export const TXN_PAGE_SIZE = 25;
interface TxnQuery { type?: string; accountId?: string; category?: string; q?: string; from?: Date; to?: Date; sort?: TxnSort; page?: number; pageSize?: number }

/**
 * One page of transactions plus the total that match. Account and category
 * filters are applied in the database (not after a row limit), so a filter never
 * silently hides matches that fall outside the first page.
 */
export async function pageTransactions(ctx: Ctx, opts: TxnQuery = {}): Promise<{ rows: TxnListItem[]; total: number }> {
  const pageSize = opts.pageSize ?? TXN_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const [accounts, categories, reversals] = await Promise.all([
    listAccounts(ctx, true),
    allCategories(ctx),
    allReversals(ctx),
  ]);
  const matchingCats = opts.category ? (categories.data ?? []).filter((c) => nameMatches(c.name as string, opts.category!)).map((c) => c.id as string) : null;
  if (matchingCats && matchingCats.length === 0) return { rows: [], total: 0 };

  let sel = "*, ledger_entries(account_id, category_id, amount)";
  if (opts.accountId) sel += ", fa:ledger_entries!inner(account_id)";
  if (matchingCats) sel += ", fc:ledger_entries!inner(category_id)";
  let q = ctx.supabase.from("transactions").select(sel, { count: "exact" }).eq("space_id", ctx.space.id);
  if (opts.accountId) q = q.eq("fa.account_id", opts.accountId);
  if (matchingCats) q = q.in("fc.category_id", matchingCats);
  if (opts.type) q = q.eq("type", opts.type);
  if (opts.from) q = q.gte("occurred_at", opts.from.toISOString());
  if (opts.to) q = q.lt("occurred_at", opts.to.toISOString());
  if (opts.q) {
    const t = opts.q.replace(/[%,()]/g, " ");
    q = q.or(`merchant.ilike.%${t}%,description.ilike.%${t}%`);
  }
  const sort = opts.sort ?? "date_desc";
  q = sort.startsWith("amount") ? q.order("amount", { ascending: sort === "amount_asc" }).order("occurred_at", { ascending: false }).order("recorded_at", { ascending: false }) : q.order("occurred_at", { ascending: sort === "date_asc" }).order("recorded_at", { ascending: sort === "date_asc" });
  // Last tie-break keeps pages stable: rows recorded in the same instant never swap between pages.
  q = q.order("id", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);
  const { data, count } = await q;
  // A page past the end makes PostgREST error without a count; ask page 1 for the total so callers can redirect.
  if (!data?.length && page > 1) return { rows: [], total: (await pageTransactions(ctx, { ...opts, page: 1, pageSize: 1 })).total };
  const rows = (data ?? []) as unknown as (TransactionRow & { ledger_entries: { account_id: string | null; category_id: string | null; amount: number }[] })[];

  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryName = new Map((categories.data ?? []).map((c) => [c.id as string, c.name as string]));
  const expenseCats = new Set((categories.data ?? []).filter((c) => c.kind === "expense").map((c) => c.id as string));
  const reversedIds = new Set((reversals.data ?? []).map((r) => r.reversal_of as string));

  return {
    total: count ?? rows.length,
    rows: rows.map((r) => ({
      ...r,
      categoryName: r.ledger_entries.map((e) => (e.category_id ? categoryName.get(e.category_id) : undefined)).find(Boolean) ?? null,
      accountNames: r.ledger_entries.map((e) => (e.account_id ? accountName.get(e.account_id) : undefined)).filter((n): n is string => !!n),
      reversed: reversedIds.has(r.id),
      expenseAmount: r.ledger_entries.filter((e) => e.category_id && expenseCats.has(e.category_id)).reduce((s, e) => s + Number(e.amount), 0),
    })),
  };
}

/** The most recent transactions matching the filters, without paging (used by summaries and exports). */
export async function listTransactions(ctx: Ctx, opts: { type?: string; accountId?: string; category?: string; q?: string; limit?: number; from?: Date; to?: Date } = {}): Promise<TxnListItem[]> {
  const { limit, ...rest } = opts;
  const size = Math.min(limit ?? 100, 1000);
  const out: TxnListItem[] = [];
  // PostgREST caps a response at 1000 rows; page until the requested limit is met.
  for (let page = 1; out.length < (limit ?? 100); page++) {
    const { rows } = await pageTransactions(ctx, { ...rest, page, pageSize: size });
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out.slice(0, limit ?? 100);
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
    allCategories(ctx),
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
  lines: { categoryId: string; categoryName: string; status: BudgetStatus; level: AlertLevel; carried: number }[];
  carriedFrom: string;
  total: BudgetStatus;
}

export async function listBudgets(ctx: Ctx): Promise<BudgetView[]> {
  const month = await currentMonth(ctx);
  const [{ data: budgets }, { data: allocs }, cats] = await Promise.all([
    ctx.supabase.from("budgets").select("id,name,warn_at,rollover,starts_on,carry_overspend").eq("space_id", ctx.space.id).is("archived_at", null).order("created_at"),
    ctx.supabase.from("budget_allocations").select("budget_id,category_id,amount").eq("space_id", ctx.space.id),
    listCategories(ctx),
  ]);
  // One query covers the previous and current month so rollover can be applied.
  const prevYear = month.month === 1 ? month.year - 1 : month.year;
  const prevMonth = month.month === 1 ? 12 : month.month - 1;
  const prev = monthRange(prevYear, prevMonth, ctx.profile.timezone);
  const { data: entries } = await ctx.supabase
    .from("ledger_entries")
    .select("category_id, amount, transactions!inner(occurred_at,status)")
    .eq("space_id", ctx.space.id)
    .not("category_id", "is", null)
    .eq("transactions.status", "posted")
    .gte("transactions.occurred_at", prev.from.toISOString())
    .lt("transactions.occurred_at", month.to.toISOString());
  const spent = new Map<string, number>();
  const prevSpent = new Map<string, number>();
  for (const e of (entries ?? []) as unknown as { category_id: string; amount: number; transactions: { occurred_at: string } | { occurred_at: string }[] }[]) {
    const t = Array.isArray(e.transactions) ? e.transactions[0] : e.transactions;
    const into = new Date(t.occurred_at) >= month.from ? spent : prevSpent;
    into.set(e.category_id, (into.get(e.category_id) ?? 0) + Number(e.amount));
  }
  const name = new Map(cats.map((c) => [c.id, c.name]));
  const thisMonthStart = `${month.year}-${String(month.month).padStart(2, "0")}-01`;
  const carriedFrom = new Intl.DateTimeFormat("en-IN", { timeZone: ctx.profile.timezone, month: "long" }).format(prev.from);

  return (budgets ?? []).map((b) => {
    const mine = (allocs ?? []).filter((a) => a.budget_id === b.id);
    const startedBefore = String(b.starts_on) < thisMonthStart;
    const lines = mine.map((a) => {
      const limit = Number(a.amount);
      const carried = carriedIn({
        rolloverEnabled: Boolean(b.rollover),
        startedBeforePeriod: startedBefore,
        allocated: limit,
        prevActual: prevSpent.get(a.category_id as string) ?? 0,
        carryOverspend: Boolean(b.carry_overspend),
      });
      const status = budgetStatus({ allocated: limit + carried, actual: spent.get(a.category_id as string) ?? 0 });
      return { categoryId: a.category_id as string, categoryName: name.get(a.category_id as string) ?? "Category", status, level: alertLevel(status, Number(b.warn_at)), carried };
    });
    const total = budgetStatus({
      allocated: lines.reduce((s, l) => s + l.status.allocated, 0),
      actual: lines.reduce((s, l) => s + l.status.actual, 0),
    });
    return { id: b.id as string, name: b.name as string, warnAt: Number(b.warn_at), rollover: Boolean(b.rollover), lines, total, carriedFrom };
  });
}
