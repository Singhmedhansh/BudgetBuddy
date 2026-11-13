import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, formatDate, Money, PageHeader } from "@/components/app/ui";
import { displayAmount } from "@/domain/display";
import { periodTotals, type LedgerAccount } from "@/domain/ledger";
import { requireSpace } from "@/server/context";
import { currentMonth, listAccounts, listBudgets, listTransactions, postingsInRange } from "@/server/queries";
import { isLiability } from "@/server/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireSpace();
  const { space, profile } = ctx;
  const [accounts, budgets, recent, month] = await Promise.all([listAccounts(ctx), listBudgets(ctx), listTransactions(ctx, { limit: 5 }), currentMonth(ctx)]);

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" description="Your overview will fill in as you add accounts and transactions." />
        <EmptyState
          title="Start with an account"
          body="Add a bank account, wallet or card so Budget Buddy has somewhere to record your money. Then add a transaction or create a budget."
          action={{ href: "/app/accounts/new", label: "Add an account" }}
        />
      </>
    );
  }

  const { postings, kinds } = await postingsInRange(ctx, month.from, month.to);
  const ledgerAccounts: LedgerAccount[] = [...kinds].map(([id, kind]) => ({ id, kind, currency: space.currency }));
  const totals = periodTotals(ledgerAccounts, postings, month.from, month.to);
  const held = accounts.filter((a) => !isLiability(a.type)).reduce((s, a) => s + a.balance, 0);
  const owed = accounts.filter((a) => isLiability(a.type)).reduce((s, a) => s + a.balance, 0);
  const attention = budgets.flatMap((b) => b.lines.filter((l) => l.level !== "ok").map((l) => ({ b, l })));
  const monthLabel = new Intl.DateTimeFormat("en-IN", { timeZone: profile.timezone, month: "long", year: "numeric" }).format(month.from);

  return (
    <>
      <PageHeader title="Dashboard" description={`${monthLabel}. Figures come from the transactions you have recorded.`} action={{ href: "/app/transactions/new", label: "Add transaction" }} />

      <dl className="grid gap-px overflow-hidden rounded-md border border-line-strong bg-line-strong sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Net worth" help="Money you hold minus what you owe">
          <Money minor={held - owed} currency={space.currency} />
        </Stat>
        <Stat label="Money you hold" help="Across your accounts">
          <Money minor={held} currency={space.currency} />
        </Stat>
        <Stat label="Income this month" help="Received, not expected">
          <Money minor={totals.income} currency={space.currency} className="text-pos-text" />
        </Stat>
        <Stat label="Spending this month" help="Transfers are not counted">
          <Money minor={totals.expenses} currency={space.currency} />
        </Stat>
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="recent">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recent" className="font-semibold">
              Recent transactions
            </h2>
            <Link href="/app/transactions" className="text-sm text-primary hover:underline">
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState title="No transactions yet" body="Record your first expense or income and it will show up here." action={{ href: "/app/transactions/new", label: "Add transaction" }} />
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.merchant || t.description || t.categoryName || "Transaction"}</p>
                    <p className="truncate text-xs text-muted">
                      {formatDate(t.occurred_at, profile.timezone)} · {t.type === "transfer" ? "Transfer" : t.categoryName}
                    </p>
                  </div>
                  <Money minor={displayAmount({ type: t.type, amount: t.amount, isReversal: Boolean(t.reversal_of) })} currency={t.currency} signed={t.type !== "transfer" && t.type !== "adjustment"} className="text-sm" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="budgets">
          <h2 id="budgets" className="mb-3 font-semibold">
            Budget watch
          </h2>
          {budgets.length === 0 ? (
            <EmptyState title="No budgets yet" body="Set monthly limits to see what is left in each category." action={{ href: "/app/budgets/new", label: "Create a budget" }} />
          ) : attention.length === 0 ? (
            <p className="text-sm text-muted">Every budgeted category is within its limit.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {attention.map(({ b, l }) => (
                <li key={`${b.id}-${l.categoryId}`} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <span>{l.categoryName}</span>
                  <span className={l.level === "over" ? "text-neg-text" : "text-warn-text"}>
                    {l.level === "over" ? "Over by " : "Left: "}
                    <Money minor={l.level === "over" ? l.status.overBudget : l.status.remaining} currency={space.currency} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {owed > 0 ? (
            <p className="mt-6 text-sm text-muted">
              You owe <Money minor={owed} currency={space.currency} className="font-medium text-fg" /> on cards and loans. Repayments are transfers and are not counted as spending.
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}

function Stat({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{children}</dd>
      <p className="mt-1 text-xs text-muted">{help}</p>
    </div>
  );
}
