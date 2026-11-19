import type { Metadata } from "next";
import Link from "next/link";
import { LoadSampleButton } from "@/components/app/sample-data-forms";
import { ProfileBanner } from "@/components/app/ProfileBanner";
import { EmptyState, formatDate, formatDay, Money, PageHeader } from "@/components/app/ui";
import { TrendChart } from "@/components/app/TrendChart";
import { monthsBack, shares } from "@/domain/analytics";
import { displayAmount } from "@/domain/display";
import { normalizeDashboardPrefs } from "@/domain/profile";
import { periodTotals, spendingByCategory, type LedgerAccount } from "@/domain/ledger";
import { localDate, monthRange } from "@/domain/period";
import { addDays } from "@/domain/recurrence";
import { requireSpace } from "@/server/context";
import { listGoals, listRecurring, todayFor } from "@/server/planning";
import { currentMonth, listAccounts, listBudgets, listCategories, listTransactions, postingsInRange } from "@/server/queries";
import { isLiability } from "@/server/types";

export const metadata: Metadata = { title: "Dashboard" };

const SWATCH = ["var(--primary)", "var(--info)", "var(--warn)", "var(--neg)", "var(--line-strong)"];

export default async function DashboardPage() {
  const ctx = await requireSpace();
  const { space, profile } = ctx;
  const tz = profile.timezone;
  const prefs = normalizeDashboardPrefs(profile.dashboard_prefs);
  const now = localDate(new Date(), tz);
  const trendMonths = monthsBack(now.year, now.month, 6);
  const trendStart = monthRange(trendMonths[0].year, trendMonths[0].month, tz).from;
  // One wave of independent reads. The month range is plain date arithmetic, so the trend postings no longer have to
  // wait for the account and budget queries, and the optional panels load alongside rather than after them.
  const monthEnd = monthRange(now.year, now.month, tz).to;
  const [accounts, budgets, recent, month, cats, bills, subs, goals, trendData] = await Promise.all([
    listAccounts(ctx),
    listBudgets(ctx),
    listTransactions(ctx, { limit: 6 }),
    currentMonth(ctx),
    listCategories(ctx),
    prefs.upcoming ? listRecurring(ctx, "bill") : [],
    prefs.upcoming ? listRecurring(ctx, "subscription") : [],
    prefs.goals ? listGoals(ctx) : [],
    postingsInRange(ctx, trendStart, monthEnd),
  ]);
  const today = todayFor(ctx);
  const upcoming = [...bills, ...subs]
    .filter((i) => i.due && i.due.date <= addDays(today, 30))
    .sort((a, b) => a.due!.date.localeCompare(b.due!.date))
    .slice(0, 5);
  const activeGoals = goals.filter((g) => g.status === "active").slice(0, 3);

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" description="Your overview will fill in as you add accounts and transactions." />
        <ProfileBanner profile={profile} />
        <EmptyState
          title="Start with an account"
          body="Add a bank account, wallet or card so FinTrack has somewhere to record your money. Then add a transaction or create a budget."
          action={{ href: "/app/accounts/new", label: "Add an account" }}
        />
        <div className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="font-semibold">Just looking around?</h2>
          <p className="mb-4 mt-1 text-sm text-muted">Load a fictional household to see the dashboard, budgets and reports with real-looking numbers. You can remove it later.</p>
          <LoadSampleButton />
        </div>
      </>
    );
  }

  const { postings, kinds } = trendData;
  const ledger: LedgerAccount[] = [...kinds].map(([id, kind]) => ({ id, kind, currency: space.currency }));
  const totals = periodTotals(ledger, postings, month.from, month.to);
  const byCat = spendingByCategory(ledger, postings, month.from, month.to);
  const catName = new Map(cats.map((x) => [x.id, x.name]));
  const catShares = shares([...byCat].map(([id, amount]) => ({ key: catName.get(id) ?? "Other", amount })));
  const top = catShares.sort((a, b) => b.amount - a.amount).slice(0, 5);
  const trend = trendMonths.map((m) => {
    const r = monthRange(m.year, m.month, tz);
    const t = periodTotals(ledger, postings, r.from, r.to);
    return { label: new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short" }).format(new Date(Date.UTC(m.year, m.month - 1, 1))), income: t.income, expenses: t.expenses };
  });

  const held = accounts.filter((a) => !isLiability(a.type)).reduce((s, a) => s + a.balance, 0);
  const owed = accounts.filter((a) => isLiability(a.type)).reduce((s, a) => s + a.balance, 0);
  const attention = budgets.flatMap((b) => b.lines.filter((l) => l.level !== "ok").map((l) => ({ b, l })));
  const monthLabel = new Intl.DateTimeFormat("en-IN", { timeZone: tz, month: "long", year: "numeric" }).format(month.from);
  const flowTotal = totals.income + totals.expenses;
  const keptPct = totals.income > 0 ? Math.max(0, Math.round(((totals.income - totals.expenses) / totals.income) * 100)) : null;

  return (
    <>
      <PageHeader title="Dashboard" description={`${monthLabel}. Figures come from the transactions you have recorded.`} action={{ href: "/app/transactions/new", label: "Add transaction" }} help={{ slug: "how-totals-work", label: "how these figures are worked out" }} />
      <ProfileBanner profile={profile} />

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Net worth: the one dark, high-contrast card on the page */}
        <section aria-label="Net worth" className="relative overflow-hidden rounded-2xl bg-ink p-6 text-white shadow-card sm:p-7">
          <div aria-hidden className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-primary/40 blur-3xl" />
          <p className="relative text-sm text-white/60">Net worth</p>
          <p className="relative mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
            <Money minor={held - owed} currency={space.currency} />
          </p>
          <p className="relative mt-1 text-xs text-white/50">Money you hold minus what you owe</p>
          <dl className="relative mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/8 p-3.5 ring-1 ring-white/10 backdrop-blur">
              <dt className="text-xs text-white/60">You hold</dt>
              <dd className="mt-0.5 text-lg font-semibold">
                <Money minor={held} currency={space.currency} />
              </dd>
            </div>
            <div className="rounded-xl bg-white/8 p-3.5 ring-1 ring-white/10 backdrop-blur">
              <dt className="text-xs text-white/60">You owe</dt>
              <dd className="mt-0.5 text-lg font-semibold">
                <Money minor={owed} currency={space.currency} />
              </dd>
            </div>
          </dl>
          <ul className="relative mt-5 space-y-2 border-t border-white/10 pt-4 text-sm">
            {[...accounts].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 3).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 text-white/70">
                <span className="truncate">{a.name}</span>
                <Money minor={isLiability(a.type) ? -a.balance : a.balance} currency={space.currency} className="shrink-0 text-white" />
              </li>
            ))}
            {accounts.length > 3 ? (
              <li>
                <Link href="/app/accounts" className="text-xs text-mint hover:underline">
                  All {accounts.length} accounts
                </Link>
              </li>
            ) : null}
          </ul>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Stat label="Income this month" note="Received, not expected">
            <Money minor={totals.income} currency={space.currency} className="text-pos-text" />
          </Stat>
          <Stat label="Spending this month" note="Transfers are not counted">
            <Money minor={totals.expenses} currency={space.currency} />
            {flowTotal > 0 ? (
              <span className="mt-3 block" aria-hidden>
                <span className="flex h-1.5 overflow-hidden rounded-full bg-sunken">
                  <i className="anim-grow block bg-pos" style={{ width: `${(totals.income / flowTotal) * 100}%` }} />
                </span>
              </span>
            ) : null}
            {keptPct !== null ? <span className="mt-2 block text-xs font-normal text-muted">You kept about {keptPct}% of what came in.</span> : null}
          </Stat>
        </div>
      </div>

      {prefs.categories || prefs.budgets ? <div className={`mt-6 grid gap-6 ${prefs.categories && prefs.budgets ? "lg:grid-cols-2" : ""}`}>
        {prefs.categories ? (
        <Panel title="Where it went" action={{ href: "/app/analytics", label: "Analytics" }}>
          {top.length === 0 ? (
            <p className="text-sm text-muted">No spending recorded this month yet.</p>
          ) : (
            <>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-sunken" role="presentation">
                {top.map((s, i) => (
                  <i key={s.key} className="anim-grow block" style={{ width: `${s.percent}%`, background: SWATCH[i % SWATCH.length], animationDelay: `${i * 80}ms` }} />
                ))}
              </div>
              <ul className="mt-4 space-y-2.5 text-sm">
                {top.map((s, i) => (
                  <li key={s.key} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <i aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SWATCH[i % SWATCH.length] }} />
                      <span className="truncate">{s.key}</span>
                    </span>
                    <span className="num shrink-0 text-muted">
                      <Money minor={s.amount} currency={space.currency} className="text-fg" /> · {s.percent}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
        ) : null}

        {prefs.budgets ? (
        <Panel title="Budget watch" action={{ href: "/app/budgets", label: "Budgets" }}>
          {budgets.length === 0 ? (
            <p className="text-sm text-muted">
              No budgets yet.{" "}
              <Link href="/app/budgets/new" className="text-primary hover:underline">
                Create one
              </Link>{" "}
              to see what is left in each category.
            </p>
          ) : attention.length === 0 ? (
            <p className="text-sm text-muted">Every budgeted category is within its limit.</p>
          ) : (
            <ul className="space-y-3">
              {attention.map(({ b, l }) => {
                const pct = Math.min(100, Math.round((l.status.usedRatio ?? 0) * 100));
                return (
                  <li key={`${b.id}-${l.categoryId}`} className="text-sm">
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="font-medium">{l.categoryName}</span>
                      <span className={`text-xs ${l.level === "over" ? "text-neg-text" : "text-warn-text"}`}>
                        {l.level === "over" ? "Over by " : "Left: "}
                        <Money minor={l.level === "over" ? l.status.overBudget : l.status.remaining} currency={space.currency} />
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                      <div className={`anim-grow h-full rounded-full ${l.level === "over" ? "bg-neg" : "bg-warn"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {owed > 0 ? (
            <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-muted">
              You owe <Money minor={owed} currency={space.currency} className="font-medium text-fg" /> on cards and loans. Repayments are transfers and are not counted as spending.
            </p>
          ) : null}
        </Panel>
        ) : null}
      </div> : null}

      {prefs.upcoming || prefs.goals ? <div className={`mt-6 grid gap-6 ${prefs.upcoming && prefs.goals ? "lg:grid-cols-2" : ""}`}>
        {prefs.upcoming ? (
        <Panel title="Coming up" action={{ href: "/app/calendar", label: "Calendar" }}>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing due in the next 30 days.{" "}
              <Link href="/app/bills/new" className="text-primary hover:underline">
                Add a bill
              </Link>{" "}
              to be reminded before it is due.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.name}</p>
                    <p className={`text-xs ${i.due!.state === "overdue" ? "text-neg-text" : i.due!.state === "due_soon" ? "text-warn-text" : "text-muted"}`}>
                      {i.due!.state === "overdue" ? "Overdue since " : "Due "}
                      {formatDay(i.due!.date)}
                    </p>
                  </div>
                  <Money minor={i.amount} currency={space.currency} className="shrink-0 font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        ) : null}

        {prefs.goals ? (
        <Panel title="Savings goals" action={{ href: "/app/goals", label: "Goals" }}>
          {activeGoals.length === 0 ? (
            <p className="text-sm text-muted">
              No active goals.{" "}
              <Link href="/app/goals/new" className="text-primary hover:underline">
                Create one
              </Link>{" "}
              and put money towards it.
            </p>
          ) : (
            <ul className="space-y-4">
              {activeGoals.map((g) => (
                <li key={g.id} className="text-sm">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium">{g.name}</span>
                    <span className="shrink-0 text-xs text-muted">
                      <Money minor={g.saved} currency={space.currency} /> of <Money minor={g.target} currency={space.currency} />
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${Math.round(g.ratio * 100)} percent saved`}>
                    <div className="anim-grow h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round(g.ratio * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        ) : null}
      </div> : null}

      {prefs.recent || prefs.trend ? <div className={`mt-6 grid gap-6 ${prefs.recent && prefs.trend ? "lg:grid-cols-[1.3fr_1fr]" : ""}`}>
        {prefs.recent ? (
        <Panel title="Recent transactions" action={{ href: "/app/transactions", label: "View all" }}>
          {recent.length === 0 ? (
            <EmptyState title="No transactions yet" body="Record your first expense or income and it will show up here." action={{ href: "/app/transactions/new", label: "Add transaction" }} />
          ) : (
            <ul className="-my-1 divide-y divide-line">
              {recent.map((t) => {
                const label = t.merchant || t.description || t.categoryName || "Transaction";
                return (
                  <li key={t.id} className="flex items-center gap-3.5 py-3">
                    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sage text-xs font-semibold text-primary">
                      {label.trim()[0]?.toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{label}</p>
                      <p className="truncate text-xs text-muted">
                        {formatDate(t.occurred_at, tz)} · {t.type === "transfer" ? "Transfer" : t.categoryName}
                      </p>
                    </div>
                    <Money minor={displayAmount({ type: t.type, amount: t.amount, isReversal: Boolean(t.reversal_of) })} currency={t.currency} signed={t.type !== "transfer" && t.type !== "adjustment"} className="shrink-0 text-sm" />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        ) : null}

        {prefs.trend ? (
        <Panel title="Six months" action={{ href: "/app/analytics?range=6m", label: "Details" }}>
          <TrendChart data={trend} currency={space.currency} />
        </Panel>
        ) : null}
      </div> : null}
    </>
  );
}

function Stat({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 transition-shadow hover:shadow-card">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{children}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action ? (
          <Link href={action.href} className="text-sm text-primary hover:underline">
            {action.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}
