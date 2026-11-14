import type { Metadata } from "next";
import { DateField } from "@/components/ui/DateField";
import Link from "next/link";
import { EmptyState, Money, PageHeader } from "@/components/app/ui";
import { TrendChart } from "@/components/app/TrendChart";
import { merchantTotals, monthsBack, percentChange, shares } from "@/domain/analytics";
import { periodTotals, spendingByCategory, type LedgerAccount } from "@/domain/ledger";
import { localDate, monthRange, startOfLocalDay } from "@/domain/period";
import { parseDate } from "@/domain/recurrence";
import { requireSpace } from "@/server/context";
import { listAccounts, listCategories, listTransactions, postingsInRange } from "@/server/queries";

export const metadata: Metadata = { title: "Analytics" };

const RANGES = [
  { id: "month", label: "This month" },
  { id: "last", label: "Last month" },
  { id: "3m", label: "Last 3 months" },
  { id: "6m", label: "Last 6 months" },
  { id: "year", label: "This year" },
] as const;

const ymd = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const tz = ctx.profile.timezone;
  const c = ctx.space.currency;
  const now = localDate(new Date(), tz);

  // ── resolve the period ──
  let from: Date;
  let to: Date;
  let label: string;
  const custom = (() => {
    if (!sp.from || !sp.to) return null;
    try {
      const a = parseDate(sp.from);
      const b = parseDate(sp.to);
      const f = startOfLocalDay(a.y, a.m, a.d, tz);
      const t = startOfLocalDay(b.y, b.m, b.d + 1, tz);
      return f < t ? { f, t } : null;
    } catch {
      return null;
    }
  })();
  const range = sp.range ?? (custom ? "custom" : "month");
  if (range === "custom" && custom) {
    from = custom.f;
    to = custom.t;
    label = `${sp.from} to ${sp.to}`;
  } else if (range === "last") {
    const p = monthsBack(now.year, now.month, 2)[0];
    ({ from, to } = monthRange(p.year, p.month, tz));
    label = "Last month";
  } else if (range === "3m" || range === "6m") {
    const n = range === "3m" ? 3 : 6;
    from = monthRange(monthsBack(now.year, now.month, n)[0].year, monthsBack(now.year, now.month, n)[0].month, tz).from;
    to = monthRange(now.year, now.month, tz).to;
    label = `Last ${n} months`;
  } else if (range === "year") {
    from = startOfLocalDay(now.year, 1, 1, tz);
    to = monthRange(now.year, now.month, tz).to;
    label = `${now.year} so far`;
  } else {
    ({ from, to } = monthRange(now.year, now.month, tz));
    label = "This month";
  }
  const length = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - length);

  // ── data ──
  const trendMonths = monthsBack(now.year, now.month, 6);
  const trendStart = monthRange(trendMonths[0].year, trendMonths[0].month, tz).from;
  const [cur, prev, trend, txns, accounts, cats] = await Promise.all([
    postingsInRange(ctx, from, to),
    postingsInRange(ctx, prevFrom, from),
    postingsInRange(ctx, trendStart, monthRange(now.year, now.month, tz).to),
    listTransactions(ctx, { from, to, limit: 100000 }),
    listAccounts(ctx, true),
    listCategories(ctx),
  ]);
  const ledger = (k: typeof cur.kinds): LedgerAccount[] => [...k].map(([id, kind]) => ({ id, kind, currency: c }));
  const totals = periodTotals(ledger(cur.kinds), cur.postings, from, to);
  const prevTotals = periodTotals(ledger(prev.kinds), prev.postings, prevFrom, from);
  const byCat = spendingByCategory(ledger(cur.kinds), cur.postings, from, to);
  const catName = new Map(cats.map((x) => [x.id, x.name]));
  const catShares = shares([...byCat].map(([id, amount]) => ({ key: catName.get(id) ?? "Other", amount })));
  const merchants = merchantTotals(txns.map((t) => ({ id: t.id, type: t.type, merchant: t.merchant, expenseAmount: t.expenseAmount, reversalOf: t.reversal_of, refundOf: t.refund_of }))).slice(0, 8);

  // spending by account: the account leg of expense postings (reversals offset them)
  const acctName = new Map(accounts.map((a) => [a.id, a.name]));
  const spendByAccount = new Map<string, number>();
  for (const p of cur.postings) {
    if (p.status !== "posted" || p.type !== "expense" || p.occurredAt < from || p.occurredAt >= to) continue;
    for (const e of p.entries) {
      const k = cur.kinds.get(e.accountId);
      if (k === "asset" || k === "liability") spendByAccount.set(e.accountId, (spendByAccount.get(e.accountId) ?? 0) - e.amount);
    }
  }
  const acctShares = shares([...spendByAccount].map(([id, amount]) => ({ key: acctName.get(id) ?? "Account", amount })));

  const trendData = trendMonths.map((m) => {
    const r = monthRange(m.year, m.month, tz);
    const t = periodTotals(ledger(trend.kinds), trend.postings, r.from, r.to);
    return { label: new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short" }).format(new Date(Date.UTC(m.year, m.month - 1, 1))), income: t.income, expenses: t.expenses };
  });

  const rangeFrom = ymd(localDate(from, tz));
  const rangeTo = ymd(localDate(new Date(to.getTime() - 1), tz));
  const spendChange = percentChange(totals.expenses, prevTotals.expenses);
  const empty = totals.income === 0 && totals.expenses === 0;

  return (
    <>
      <PageHeader title="Analytics" description={`${label}. Income is money received, spending is expenses minus refunds. Transfers, repayments and opening balances are never counted.`} help={{ slug: "analytics-explained", label: "how analytics are calculated" }} />

      <nav aria-label="Period" className="mb-8 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Link key={r.id} href={`/app/analytics?range=${r.id}`} aria-current={range === r.id ? "page" : undefined} className={`rounded-full border px-3.5 py-1.5 text-sm ${range === r.id ? "border-primary bg-sage font-medium" : "border-line-strong bg-surface text-muted hover:text-fg"}`}>
            {r.label}
          </Link>
        ))}
      </nav>
      <form className="mb-10 flex flex-wrap items-end gap-3" aria-label="Custom date range">
        <div><label htmlFor="a-from" className="mb-1 block text-xs text-muted">From</label><DateField id="a-from" name="from" label="From" size="sm" className="min-w-40" defaultValue={custom ? sp.from : rangeFrom} /></div>
        <div><label htmlFor="a-to" className="mb-1 block text-xs text-muted">To</label><DateField id="a-to" name="to" label="To" size="sm" className="min-w-40" defaultValue={custom ? sp.to : rangeTo} /></div>
        <input type="hidden" name="range" value="custom" />
        <button type="submit" className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium hover:border-primary">Apply dates</button>
      </form>

      {empty ? (
        <EmptyState title="Nothing recorded in this period" body="Try a longer range, or record some transactions first." action={{ href: "/app/transactions/new", label: "Add transaction" }} />
      ) : (
        <div className="space-y-14">
          <dl className="grid gap-px overflow-hidden rounded-md border border-line-strong bg-line-strong sm:grid-cols-3">
            <div className="bg-surface p-4"><dt className="text-sm text-muted">Income</dt><dd className="mt-1 text-xl font-semibold text-pos-text"><Money minor={totals.income} currency={c} /></dd></div>
            <div className="bg-surface p-4">
              <dt className="text-sm text-muted">Spending</dt>
              <dd className="mt-1 text-xl font-semibold"><Money minor={totals.expenses} currency={c} /></dd>
              <p className="mt-1 text-xs text-muted">{spendChange === null ? "No spending in the previous period to compare" : `${spendChange >= 0 ? "Up" : "Down"} ${Math.abs(Math.round(spendChange))}% on the previous period of the same length`}</p>
            </div>
            <div className="bg-surface p-4"><dt className="text-sm text-muted">Saved (income minus spending)</dt><dd className={`mt-1 text-xl font-semibold ${totals.net < 0 ? "text-neg-text" : ""}`}><Money minor={totals.net} currency={c} /></dd></div>
          </dl>

          <section aria-labelledby="trend">
            <h2 id="trend" className="mb-4 font-semibold">Income and spending, last 6 months</h2>
            <TrendChart data={trendData} currency={c} />
          </section>

          <section aria-labelledby="bycat">
            <h2 id="bycat" className="mb-4 font-semibold">Spending by category</h2>
            {catShares.length === 0 ? <p className="text-sm text-muted">No spending in this period.</p> : (
              <ul className="divide-y divide-line border-y border-line">
                {catShares.map((s) => (
                  <li key={s.key} className="py-3">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <Link href={`/app/transactions?cat=${encodeURIComponent(s.key)}&from=${rangeFrom}&to=${rangeTo}`} className="font-medium text-primary underline-offset-2 hover:underline">{s.key}</Link>
                      <span className="text-muted"><Money minor={s.amount} currency={c} /> · {s.percent}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden><div className="h-full bg-primary" style={{ width: `${s.percent}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-12 md:grid-cols-2">
            <section aria-labelledby="merch">
              <h2 id="merch" className="mb-4 font-semibold">Top merchants</h2>
              {merchants.length === 0 ? <p className="text-sm text-muted">Add a merchant when you record spending to see it here.</p> : (
                <ul className="divide-y divide-line border-y border-line text-sm">
                  {merchants.map((m) => (<li key={m.merchant} className="flex justify-between gap-3 py-2.5"><span>{m.merchant} <span className="text-xs text-muted">{m.count}×</span></span><Money minor={m.amount} currency={c} /></li>))}
                </ul>
              )}
            </section>
            <section aria-labelledby="byacct">
              <h2 id="byacct" className="mb-4 font-semibold">Spending by account</h2>
              {acctShares.length === 0 ? <p className="text-sm text-muted">No spending in this period.</p> : (
                <ul className="divide-y divide-line border-y border-line text-sm">
                  {acctShares.map((a) => (<li key={a.key} className="flex justify-between gap-3 py-2.5"><span>{a.key}</span><span className="text-muted"><Money minor={a.amount} currency={c} /> · {a.percent}%</span></li>))}
                </ul>
              )}
            </section>
          </div>
          <p className="text-xs text-muted">
            <a href={`/app/export/transactions?from=${rangeFrom}&to=${rangeTo}`} className="font-medium text-primary hover:underline">Download this period as CSV</a>
          </p>
        </div>
      )}
    </>
  );
}
