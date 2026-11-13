import type { Metadata } from "next";
import Link from "next/link";
import { reverseTransactionAction } from "@/app/app/actions";
import { EmptyState, formatDate, Money, Notice, PageHeader } from "@/components/app/ui";
import { requireSpace } from "@/server/context";
import { listAccounts, listTransactions } from "@/server/queries";

export const metadata: Metadata = { title: "Transactions" };

type SP = Promise<Record<string, string | undefined>>;
const TYPES = ["expense", "income", "transfer"] as const;

export default async function TransactionsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const type = TYPES.find((t) => t === sp.type);
  const [rows, accounts] = await Promise.all([
    listTransactions(ctx, { type, accountId: sp.account, q: sp.q?.slice(0, 80) }),
    listAccounts(ctx, true),
  ]);
  const filtered = Boolean(type || sp.account || sp.q);

  return (
    <>
      <PageHeader title="Transactions" description="Everything you have recorded. A transaction is never deleted: reversing one adds an offsetting entry so the history stays intact." action={{ href: "/app/transactions/new", label: "Add transaction" }} />
      {sp.added ? <Notice kind="success">Transaction saved.</Notice> : null}
      {sp.reversed ? <Notice kind="success">Transaction reversed. The original and its reversal both stay in your history.</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error === "invalid" ? "That transaction could not be found." : sp.error}</Notice> : null}

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
                  <Money minor={t.type === "expense" ? -t.amount : t.amount} currency={t.currency} signed={t.type === "income"} className={`text-sm font-medium ${t.type === "income" ? "text-pos-text" : ""}`} />
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
