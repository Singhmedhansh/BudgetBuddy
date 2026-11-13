import type { Metadata } from "next";
import Link from "next/link";
import { reverseTransactionAction } from "@/app/app/actions";
import { EmptyState, formatDate, Money, Notice, PageHeader } from "@/components/app/ui";
import { displayAmount } from "@/domain/display";
import { startOfLocalDay } from "@/domain/period";
import { parseDate } from "@/domain/recurrence";
import { requireSpace } from "@/server/context";
import { listAccounts, listCategories, listTransactions } from "@/server/queries";

export const metadata: Metadata = { title: "Transactions" };

type SP = Promise<Record<string, string | undefined>>;
const TYPES = ["expense", "income", "transfer"] as const;

export default async function TransactionsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const type = TYPES.find((t) => t === sp.type);
  const day = (v: string | undefined, add = 0) => {
    if (!v) return undefined;
    try {
      const { y, m, d } = parseDate(v);
      return startOfLocalDay(y, m, d + add, ctx.profile.timezone);
    } catch {
      return undefined;
    }
  };
  const from = day(sp.from);
  const to = day(sp.to, 1); // the end date is inclusive
  const [rows, accounts, categories] = await Promise.all([
    listTransactions(ctx, { type, accountId: sp.account, category: sp.cat?.slice(0, 60), q: sp.q?.slice(0, 80), from, to }),
    listAccounts(ctx, true),
    listCategories(ctx),
  ]);
  const filtered = Boolean(type || sp.account || sp.cat || sp.q || from || to);

  return (
    <>
      <PageHeader title="Transactions" description="Everything you have recorded. A transaction is never deleted: reversing one adds an offsetting entry so the history stays intact." action={{ href: "/app/transactions/new", label: "Add transaction" }} help={{ slug: "reverse-a-transaction", label: "reversing a transaction" }} />
      {sp.added ? <Notice kind="success">Transaction saved.</Notice> : null}
      {sp.reversed ? <Notice kind="success">Transaction reversed. The original and its reversal both stay in your history.</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error === "invalid" ? "That transaction could not be found." : sp.error}</Notice> : null}

      {from || to ? (
        <p className="mb-3 text-sm text-muted">
          Showing {sp.from ?? "the start"} to {sp.to ?? "today"}.
        </p>
      ) : null}
      <form className="mb-6 flex flex-wrap items-end gap-3" role="search">
        <div>
          <label htmlFor="q" className="mb-1 block text-xs text-muted">Search</label>
          <input id="q" name="q" defaultValue={sp.q} placeholder="Merchant or note" className="w-52 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="type" className="mb-1 block text-xs text-muted">Type</label>
          <select id="type" name="type" defaultValue={type ?? ""} className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm">
            <option value="">All types</option>
            {TYPES.map((t) => (<option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="account" className="mb-1 block text-xs text-muted">Account</label>
          <select id="account" name="account" defaultValue={sp.account ?? ""} className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm">
            <option value="">All accounts</option>
            {accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="cat" className="mb-1 block text-xs text-muted">Category</label>
          <select id="cat" name="cat" defaultValue={sp.cat ?? ""} className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm">
            <option value="">All categories</option>
            {sp.cat && !categories.some((c) => c.name.toLowerCase() === sp.cat!.toLowerCase()) ? <option value={sp.cat}>{sp.cat}</option> : null}
            {categories.map((c) => (<option key={c.id} value={c.name}>{c.name}</option>))}
          </select>
        </div>
        {sp.from ? <input type="hidden" name="from" value={sp.from} /> : null}
        {sp.to ? <input type="hidden" name="to" value={sp.to} /> : null}
        <button type="submit" className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium hover:border-primary">Apply</button>
        {filtered ? <Link href="/app/transactions" className="py-2 text-sm text-muted hover:text-fg">Clear</Link> : null}
      </form>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState title="No transactions match" body="Try a different search or clear the filters." action={{ href: "/app/transactions", label: "Clear filters" }} />
        ) : (
          <EmptyState title="No transactions yet" body="Add an expense, income or a transfer between your accounts." action={{ href: "/app/transactions/new", label: "Add transaction" }} />
        )
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {rows.map((t) => {
            const isReversal = Boolean(t.reversal_of);
            return (
              <li key={t.id} className="flex items-center justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <p className={`truncate text-sm font-medium ${t.reversed ? "text-muted line-through" : ""}`}>
                    {isReversal ? "Reversal" : t.merchant || t.description || t.categoryName || (t.type === "transfer" ? "Transfer" : "Transaction")}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {formatDate(t.occurred_at, ctx.profile.timezone)} · {t.type === "transfer" ? t.accountNames.join(" to ") : `${t.categoryName ?? ""} · ${t.accountNames[0] ?? ""}`}
                    {t.reversed ? " · Reversed" : ""}
                    {t.type === "transfer" ? " · Not spending" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <Money minor={displayAmount({ type: t.type, amount: t.amount, isReversal })} currency={t.currency} signed={t.type !== "transfer" && t.type !== "adjustment"} className={`text-sm font-medium ${displayAmount({ type: t.type, amount: t.amount, isReversal }) > 0 && t.type !== "transfer" && t.type !== "adjustment" ? "text-pos-text" : ""}`} />
                  {!t.reversed && !isReversal && t.status === "posted" ? (
                    <form action={reverseTransactionAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="text-xs text-muted underline hover:text-fg" aria-label={`Reverse transaction ${t.merchant ?? t.description ?? ""}`}>Reverse</button>
                    </form>
                  ) : (<span className="w-12" aria-hidden />)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
