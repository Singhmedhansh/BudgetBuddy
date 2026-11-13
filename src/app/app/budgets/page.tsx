import type { Metadata } from "next";
import Link from "next/link";
import { archiveBudgetAction } from "@/app/app/manage-actions";
import { EmptyState, Money, Notice, PageHeader } from "@/components/app/ui";
import { atLeast, requireSpace } from "@/server/context";
import { currentMonth, listBudgets } from "@/server/queries";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const [budgets, month] = await Promise.all([listBudgets(ctx), currentMonth(ctx)]);
  const label = new Intl.DateTimeFormat("en-IN", { timeZone: ctx.profile.timezone, month: "long", year: "numeric" }).format(month.from);
  const c = ctx.space.currency;
  const canEdit = atLeast(ctx.role, "editor");

  return (
    <>
      <PageHeader
        title="Budgets"
        description={`${label}. Spent is posted expenses minus refunds. Pending items are not counted yet. Remaining is the limit minus spent.`}
        action={canEdit ? { href: "/app/budgets/new", label: "Create budget" } : undefined}
        help={{ slug: "how-budgets-work", label: "how budget figures are calculated" }}
      />
      {sp.updated ? <Notice kind="success">Budget updated.</Notice> : null}
      {sp.archived ? <Notice kind="success">Budget archived. Your transactions are unchanged.</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error === "invalid" ? "That budget could not be found." : sp.error}</Notice> : null}
      {budgets.length === 0 ? (
        <EmptyState title="No budgets yet" body="Choose the categories you want to limit and set a monthly amount for each." action={{ href: "/app/budgets/new", label: "Create a budget" }} />
      ) : (
        <div className="space-y-12">
          {budgets.map((b) => (
            <section key={b.id} aria-labelledby={`b-${b.id}`}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-4">
                  <h2 id={`b-${b.id}`} className="font-semibold">{b.name}</h2>
                  {canEdit ? (
                    <span className="flex items-center gap-3 text-xs">
                      <Link href={`/app/budgets/${b.id}/edit`} className="text-muted underline hover:text-fg" aria-label={`Edit ${b.name}`}>Edit</Link>
                      <form action={archiveBudgetAction}>
                        <input type="hidden" name="id" value={b.id} />
                        <button type="submit" className="text-muted underline hover:text-fg" aria-label={`Archive ${b.name}`}>Archive</button>
                      </form>
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-muted">
                  <Money minor={b.total.actual} currency={c} /> of <Money minor={b.total.allocated} currency={c} /> spent
                </p>
              </div>
              <ul className="divide-y divide-line border-y border-line">
                {b.lines.map((l) => {
                  const used = Math.round((l.status.usedRatio ?? 1) * 100);
                  const pct = Math.min(100, used);
                  const tone = l.level === "over" ? "bg-neg" : l.level === "warning" ? "bg-warn" : "bg-pos";
                  return (
                    <li key={l.categoryId} className="py-3.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium">{l.categoryName}</span>
                        <span className={l.level === "over" ? "text-neg-text" : "text-muted"}>
                          {l.level === "over" ? (<>Over by <Money minor={l.status.overBudget} currency={c} /></>) : (<><Money minor={l.status.remaining} currency={c} /> left</>)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${l.categoryName} budget used`}>
                        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="num mt-1.5 text-xs text-muted">
                        <Money minor={l.status.actual} currency={c} /> of <Money minor={l.status.allocated} currency={c} /> · {used}% used{l.level === "warning" ? " · near your limit" : ""}
                        {l.carried !== 0 ? <> · includes <Money minor={l.carried} currency={c} /> carried from {b.carriedFrom}</> : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
