import type { Metadata } from "next";
import { Select } from "@/components/ui/Select";
import Link from "next/link";
import { redirect } from "next/navigation";
import { reverseTransactionAction } from "@/app/app/actions";
import { EmptyState, formatDate, Money, Notice, PageHeader } from "@/components/app/ui";
import { displayAmount } from "@/domain/display";
import { startOfLocalDay } from "@/domain/period";
import { parseDate } from "@/domain/recurrence";
import { atLeast, requireSpace } from "@/server/context";
import { listAccounts, listCategories, pageTransactions, TXN_PAGE_SIZE, type TxnSort } from "@/server/queries";

export const metadata: Metadata = { title: "Transactions" };

type SP = Promise<Record<string, string | undefined>>;
const TYPES = ["expense", "income", "transfer"] as const;
const SORTS: { value: TxnSort; label: string }[] = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "amount_desc", label: "Largest amount" },
  { value: "amount_asc", label: "Smallest amount" },
];

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
  const sort = SORTS.find((x) => x.value === sp.sort)?.value ?? "date_desc";
  const pageNo = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const accountId = /^[0-9a-f-]{36}$/i.test(sp.account ?? "") ? sp.account : undefined;
  const [{ rows, total }, accounts, categories] = await Promise.all([
    pageTransactions(ctx, { type, accountId, category: sp.cat?.slice(0, 60), q: sp.q?.slice(0, 80), from, to, sort, page: pageNo }),
    listAccounts(ctx, true),
    listCategories(ctx),
  ]);
  const filtered = Boolean(type || sp.account || sp.cat || sp.q || from || to);
  const pages = Math.max(1, Math.ceil(total / TXN_PAGE_SIZE));
  const canEdit = atLeast(ctx.role, "editor");
  const href = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page" && !["added", "reversed", "refunded", "edited", "error"].includes(k)) p.set(k, v);
    if (n > 1) p.set("page", String(n));
    const qs = p.toString();
    return `/app/transactions${qs ? `?${qs}` : ""}`;
  };
  if (total > 0 && pageNo > pages) redirect(href(pages)); // a stale page number lands on the last page, not an empty list

  return (
    <>
      <PageHeader title="Transactions" description="Everything you have recorded. A transaction is never deleted: reversing one adds an offsetting entry so the history stays intact." action={canEdit ? { href: "/app/transactions/new", label: "Add transaction" } : undefined} help={{ slug: "reverse-a-transaction", label: "reversing a transaction" }} />
      {sp.added ? <Notice kind="success">Transaction saved.</Notice> : null}
      {sp.reversed ? <Notice kind="success">Transaction reversed. The original and its reversal both stay in your history.</Notice> : null}
      {sp.refunded ? <Notice kind="success">Refund recorded. Spending in that category is reduced and the money is back in your account.</Notice> : null}
      {sp.edited ? <Notice kind="success">Details saved.</Notice> : null}
      {!canEdit ? <Notice kind="success">You have view-only access to this space.</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error === "invalid" ? "That transaction could not be found." : sp.error}</Notice> : null}

      {from || to ? (
        <p className="mb-3 text-sm text-muted">
          Showing {sp.from ?? "the start"} to {sp.to ?? "today"}.
        </p>
      ) : null}
      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4" role="search">
        <div>
          <label htmlFor="q" className="mb-1 block text-xs text-muted">Search</label>
          <input id="q" name="q" defaultValue={sp.q} placeholder="Merchant or note" className="w-52 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="type" className="mb-1 block text-xs text-muted">Type</label>
          <Select id="type" name="type" label="Type" size="sm" className="min-w-36" defaultValue={type ?? ""} options={[{ value: "", label: "All types" }, ...TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))]} />
        </div>
        <div>
          <label htmlFor="account" className="mb-1 block text-xs text-muted">Account</label>
          <Select id="account" name="account" label="Account" size="sm" className="min-w-40" defaultValue={sp.account ?? ""} options={[{ value: "", label: "All accounts" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
        </div>
        <div>
          <label htmlFor="cat" className="mb-1 block text-xs text-muted">Category</label>
          <Select id="cat" name="cat" label="Category" size="sm" className="min-w-40" defaultValue={sp.cat ?? ""} options={[{ value: "", label: "All categories" }, ...(sp.cat && !categories.some((c) => c.name.toLowerCase() === sp.cat!.toLowerCase()) ? [{ value: sp.cat, label: sp.cat }] : []), ...categories.map((c) => ({ value: c.name, label: c.name }))]} />
        </div>
        {sp.from ? <input type="hidden" name="from" value={sp.from} /> : null}
        {sp.to ? <input type="hidden" name="to" value={sp.to} /> : null}
        <div>
          <label htmlFor="sort" className="mb-1 block text-xs text-muted">Sort</label>
          <Select id="sort" name="sort" label="Sort by" size="sm" className="min-w-40" defaultValue={sort} options={SORTS.map((o) => ({ value: o.value, label: o.label }))} />
        </div>
        <button type="submit" className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover">Apply</button>
        {filtered ? <Link href="/app/transactions" className="py-2 text-sm text-muted hover:text-fg">Clear</Link> : null}
      </form>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState title="No transactions match" body="Try a different search or clear the filters." action={{ href: "/app/transactions", label: "Clear filters" }} />
        ) : (
          <EmptyState title="No transactions yet" body="Add an expense, income or a transfer between your accounts." action={{ href: "/app/transactions/new", label: "Add transaction" }} />
        )
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {rows.map((t) => {
            const isReversal = Boolean(t.reversal_of);
            return (
              <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-sunken/60">
                <div className="flex min-w-0 items-center gap-3.5">
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sage text-xs font-semibold text-primary">{(isReversal ? "R" : (t.merchant || t.description || t.categoryName || (t.type === "transfer" ? "T" : "?"))).trim()[0]?.toUpperCase()}</span>
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
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <Money minor={displayAmount({ type: t.type, amount: t.amount, isReversal })} currency={t.currency} signed={t.type !== "transfer" && t.type !== "adjustment"} className={`text-sm font-medium ${displayAmount({ type: t.type, amount: t.amount, isReversal }) > 0 && t.type !== "transfer" && t.type !== "adjustment" ? "text-pos-text" : ""}`} />
                  {canEdit && !t.reversed && !isReversal && t.status === "posted" ? (
                    <div className="flex items-center gap-3 text-xs">
                      {t.type === "expense" ? <Link href={`/app/transactions/${t.id}/refund`} className="text-muted underline hover:text-fg" aria-label={`Refund ${t.merchant ?? t.description ?? "expense"}`}>Refund</Link> : null}
                      <Link href={`/app/transactions/${t.id}/edit`} className="text-muted underline hover:text-fg" aria-label={`Edit details of ${t.merchant ?? t.description ?? "transaction"}`}>Edit</Link>
                      <form action={reverseTransactionAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" className="text-muted underline hover:text-fg" aria-label={`Reverse transaction ${t.merchant ?? t.description ?? ""}`}>Reverse</button>
                      </form>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {total > 0 ? (
        <nav aria-label="Pages" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted" aria-live="polite">
            Showing {(pageNo - 1) * TXN_PAGE_SIZE + 1} to {Math.min(total, pageNo * TXN_PAGE_SIZE)} of {total}
          </p>
          {pages > 1 ? (
            <div className="flex items-center gap-2">
              {pageNo > 1 ? <Link href={href(pageNo - 1)} rel="prev" className="rounded-full border border-line-strong px-4 py-1.5 hover:border-primary">Previous</Link> : null}
              <span className="text-muted">Page {pageNo} of {pages}</span>
              {pageNo < pages ? <Link href={href(pageNo + 1)} rel="next" className="rounded-full border border-line-strong px-4 py-1.5 hover:border-primary">Next</Link> : null}
            </div>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}