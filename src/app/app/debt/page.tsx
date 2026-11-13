import type { Metadata } from "next";
import Link from "next/link";
import { saveDebtTermsAction } from "@/app/app/planning-actions";
import { EmptyState, Money, Notice, PageHeader } from "@/components/app/ui";
import { simulatePayoff, type Debt, type PayoffResult } from "@/domain/debt";
import { MoneyError, parseAmount, toDecimalString } from "@/domain/money";
import { requireSpace } from "@/server/context";
import { listDebts } from "@/server/planning";

export const metadata: Metadata = { title: "Loans and debt" };

export default async function DebtPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const c = ctx.space.currency;
  const debts = await listDebts(ctx);

  const withTerms: Debt[] = debts
    .filter((d) => d.rateBps !== null && d.minPayment !== null && d.owed > 0)
    .map((d) => ({ id: d.accountId, name: d.name, balance: d.owed, rateBps: d.rateBps!, minPayment: d.minPayment! }));
  const minimums = withTerms.reduce((s, d) => s + d.minPayment, 0);

  let budget = minimums;
  let budgetError: string | undefined;
  if (sp.budget) {
    try {
      const parsed = parseAmount(sp.budget, c);
      if (parsed < minimums) budgetError = `That is less than the minimum payments, ${toDecimalString(minimums, c)} ${c}, so it cannot cover them.`;
      else budget = parsed;
    } catch (e) {
      budgetError = e instanceof MoneyError ? e.message : "Enter an amount like 15000.";
    }
  }
  const plans: PayoffResult[] | null = withTerms.length > 0 && !budgetError ? [simulatePayoff(withTerms, budget, "avalanche"), simulatePayoff(withTerms, budget, "snowball")] : null;
  const nameOf = (id: string) => debts.find((d) => d.accountId === id)?.name ?? "Debt";

  return (
    <>
      <PageHeader
        title="Loans and debt"
        description="Your credit cards and loans, with the terms you enter. Balances come from your recorded transactions. Repayments are transfers, so they are not counted as spending."
        action={{ href: "/app/accounts/new", label: "Add a loan or card" }}
        help={{ slug: "debt-payoff", label: "how the payoff plan works" }}
      />
      {sp.saved ? <Notice kind="success">Terms saved.</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}

      {debts.length === 0 ? (
        <EmptyState title="No loans or cards yet" body="Add an account of type Credit card or Other liability, then come back to enter its interest rate and minimum payment." action={{ href: "/app/accounts/new", label: "Add an account" }} />
      ) : (
        <>
          <ul className="divide-y divide-line border-y border-line">
            {debts.map((d) => (
              <li key={d.accountId} className="py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">{d.name}</h2>
                  <p className="text-sm">
                    Owed <Money minor={d.owed} currency={c} className="font-medium" />
                  </p>
                </div>
                <form action={saveDebtTermsAction} className="mt-3 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="accountId" value={d.accountId} />
                  <div>
                    <label htmlFor={`rate-${d.accountId}`} className="mb-1 block text-xs text-muted">Interest per year (%)</label>
                    <input id={`rate-${d.accountId}`} name="rate" inputMode="decimal" defaultValue={d.rateBps !== null ? String(d.rateBps / 100) : ""} className="w-28 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label htmlFor={`min-${d.accountId}`} className="mb-1 block text-xs text-muted">Minimum payment ({c})</label>
                    <input id={`min-${d.accountId}`} name="minPayment" inputMode="decimal" defaultValue={d.minPayment !== null ? toDecimalString(d.minPayment, c) : ""} className="w-36 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label htmlFor={`day-${d.accountId}`} className="mb-1 block text-xs text-muted">Due day of month</label>
                    <input id={`day-${d.accountId}`} name="dueDay" inputMode="numeric" defaultValue={d.dueDay ?? ""} className="w-24 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
                  </div>
                  <button type="submit" className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium hover:border-primary">
                    Save terms
                  </button>
                </form>
              </li>
            ))}
          </ul>

          <section aria-labelledby="planner" className="mt-12">
            <h2 id="planner" className="text-lg font-semibold">Payoff planner</h2>
            <p className="mt-1 max-w-[62ch] text-sm text-muted">
              A projection from the balances, rates and payments above. It is not a figure from your lender and ignores fees, changing rates and how they apply your payments.
            </p>
            {withTerms.length === 0 ? (
              <p className="mt-4 text-sm text-muted">Enter an interest rate and minimum payment for at least one debt that you still owe to see a plan.</p>
            ) : (
              <>
                <form className="mt-5 flex flex-wrap items-end gap-3" role="search" aria-label="Payoff planner">
                  <div>
                    <label htmlFor="budget" className="mb-1 block text-xs text-muted">Total you can pay each month ({c})</label>
                    <input id="budget" name="budget" inputMode="decimal" defaultValue={sp.budget ?? toDecimalString(minimums, c)} className="w-40 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
                  </div>
                  <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:bg-primary-hover">Update plan</button>
                  <p className="basis-full text-xs text-muted">Minimum payments across your debts add up to <Money minor={minimums} currency={c} />.</p>
                </form>
                {budgetError ? <p role="alert" className="mt-3 text-sm text-neg-text">{budgetError}</p> : null}
                {plans ? (
                  <div className="mt-6 grid gap-6 md:grid-cols-2">
                    {plans.map((p) => (
                      <div key={p.strategy} className="rounded-md border border-line-strong bg-surface p-4">
                        <h3 className="font-semibold">{p.strategy === "avalanche" ? "Avalanche: highest rate first" : "Snowball: smallest balance first"}</h3>
                        {p.feasible ? (
                          <dl className="mt-3 space-y-1.5 text-sm">
                            <div className="flex justify-between gap-3"><dt className="text-muted">Debt-free in</dt><dd>{Math.floor(p.months / 12) > 0 ? `${Math.floor(p.months / 12)} yr ` : ""}{p.months % 12} mo</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-muted">Total interest</dt><dd><Money minor={p.totalInterest} currency={c} /></dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-muted">Total paid</dt><dd><Money minor={p.totalPaid} currency={c} /></dd></div>
                            <div><dt className="text-muted">Order paid off</dt><dd className="mt-0.5">{p.order.map((id, i) => `${i + 1}. ${nameOf(id)} (month ${p.payoffMonth[id]})`).join("; ")}</dd></div>
                          </dl>
                        ) : (
                          <p className="mt-3 text-sm text-warn-text">At this monthly amount the balances never reach zero within 100 years, because interest keeps up with the payments. Try a higher amount.</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>
          <p className="mt-10 text-xs text-muted">
            To record a repayment, add a <Link href="/app/transactions/new" className="underline">transfer</Link> from your bank account to the card or loan.
          </p>
        </>
      )}
    </>
  );
}
