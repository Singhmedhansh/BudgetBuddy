import type { Metadata } from "next";
import { DateField } from "@/components/ui/DateField";
import { Select } from "@/components/ui/Select";
import Link from "next/link";
import { EmptyState, formatDay, Money, PageHeader } from "@/components/app/ui";
import { BalanceChart } from "@/components/app/BalanceChart";
import { daysOfCover, forecast } from "@/domain/forecast";
import { MoneyError, parseAmount } from "@/domain/money";
import { parseDate } from "@/domain/recurrence";
import { requireSpace } from "@/server/context";
import { forecastBasis } from "@/server/forecast";

export const metadata: Metadata = { title: "Forecast" };

const HORIZONS = [30, 60, 90] as const;
const CONF = { low: "Low: there is little history to learn from", medium: "Medium: about a month or two of history", high: "Higher: two months or more of history" } as const;

export default async function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const c = ctx.space.currency;
  const days = HORIZONS.find((d) => String(d) === sp.days) ?? 30;
  const basis = await forecastBasis(ctx, days);

  const pctRaw = Number(sp.spend ?? 0);
  const pct = Number.isFinite(pctRaw) ? Math.max(-100, Math.min(200, Math.round(pctRaw))) : 0;
  let oneOffs: { date: string; amount: number }[] = [];
  let oneOffError: string | undefined;
  if (sp.oneoff) {
    try {
      const amount = parseAmount(sp.oneoff, c);
      parseDate(sp.oneoffDate ?? "");
      if (sp.oneoffDate! <= basis.today) oneOffError = "Choose a date after today.";
      else oneOffs = [{ date: sp.oneoffDate!, amount: sp.oneoffKind === "in" ? Math.abs(amount) : -Math.abs(amount) }];
    } catch (e) {
      oneOffError = e instanceof MoneyError ? e.message : "Enter an amount and a date for the one-off.";
    }
  }

  const base = forecast({ today: basis.today, days, startBalance: basis.startBalance, events: basis.events, dailySpend: basis.dailySpend });
  const result = pct !== 0 || oneOffs.length ? forecast({ today: basis.today, days, startBalance: basis.startBalance, events: basis.events, dailySpend: basis.dailySpend, spendChangePct: pct, oneOffs }) : base;
  const whatIf = pct !== 0 || oneOffs.length > 0;
  const cover = daysOfCover(Math.max(0, basis.startBalance), result.dailyVariable);
  const upcoming = basis.events.filter((e) => e.date <= basis.today || e.date <= result.points[result.points.length - 1].date).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);

  return (
    <>
      <PageHeader title="Forecast" description="An estimate of your cash balance, built from what you have recorded. It is not a prediction you can rely on, and it changes as your records change." help={{ slug: "forecast-explained", label: "how the forecast works" }} />

      {basis.accountNames.length === 0 ? (
        <EmptyState title="Add an account first" body="The forecast starts from your cash balance, so it needs at least one savings, current, cash or wallet account." action={{ href: "/app/accounts/new", label: "Add an account" }} />
      ) : (
        <>
          <nav aria-label="Forecast length" className="mb-6 flex gap-2">
            {HORIZONS.map((h) => (
              <Link key={h} href={`/app/forecast?days=${h}${pct ? `&spend=${pct}` : ""}`} aria-current={days === h ? "page" : undefined} className={`rounded-full border px-3.5 py-1.5 text-sm ${days === h ? "border-primary bg-sage font-medium" : "border-line-strong bg-surface text-muted hover:text-fg"}`}>
                {h} days
              </Link>
            ))}
          </nav>

          <dl className="grid gap-px overflow-hidden rounded-md border border-line-strong bg-line-strong sm:grid-cols-3">
            <div className="bg-surface p-4"><dt className="text-sm text-muted">Cash today <span className="text-xs">(actual)</span></dt><dd className="mt-1 text-xl font-semibold"><Money minor={basis.startBalance} currency={c} /></dd></div>
            <div className="bg-surface p-4"><dt className="text-sm text-muted">Estimated in {days} days <span className="text-xs">(forecast)</span></dt><dd className={`mt-1 text-xl font-semibold ${result.endBalance < 0 ? "text-neg-text" : ""}`}><Money minor={result.endBalance} currency={c} /></dd>{whatIf ? <p className="mt-1 text-xs text-muted">Without your what-if changes: <Money minor={base.endBalance} currency={c} /></p> : null}</div>
            <div className="bg-surface p-4"><dt className="text-sm text-muted">Lowest point</dt><dd className="mt-1 text-xl font-semibold"><Money minor={result.lowest.balance} currency={c} /></dd><p className="mt-1 text-xs text-muted">around {formatDay(result.lowest.date)}</p></div>
          </dl>

          {result.firstNegative ? (
            <p role="status" className="mt-4 rounded-md border border-warn/60 bg-warn/10 px-4 py-3 text-sm text-warn-text">
              On these assumptions your cash could fall below zero around {formatDay(result.firstNegative)}. This is an estimate. Check the bills and income below.
            </p>
          ) : null}

          <section aria-labelledby="chart" className="mt-10">
            <h2 id="chart" className="mb-3 font-semibold">Projected cash balance</h2>
            <BalanceChart points={result.points} currency={c} />
          </section>

          <section aria-labelledby="whatif" className="mt-12">
            <h2 id="whatif" className="font-semibold">What if</h2>
            <form className="mt-3 flex flex-wrap items-end gap-4" aria-label="What-if scenario">
              <input type="hidden" name="days" value={days} />
              <div>
                <label htmlFor="spend" className="mb-1 block text-xs text-muted">Change everyday spending by (%)</label>
                <input id="spend" name="spend" inputMode="numeric" defaultValue={pct || ""} placeholder="-10" className="w-28 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="oneoff" className="mb-1 block text-xs text-muted">One-off amount ({c})</label>
                <input id="oneoff" name="oneoff" inputMode="decimal" defaultValue={sp.oneoff} className="w-32 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="oneoffKind" className="mb-1 block text-xs text-muted">It is</label>
                <Select id="oneoffKind" name="oneoffKind" label="It is" size="sm" className="min-w-36" defaultValue={sp.oneoffKind ?? "out"} options={[{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }]} />
              </div>
              <div>
                <label htmlFor="oneoffDate" className="mb-1 block text-xs text-muted">On</label>
                <DateField id="oneoffDate" name="oneoffDate" label="On" size="sm" className="min-w-40" min={basis.today} defaultValue={sp.oneoffDate} clearable />
              </div>
              <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:bg-primary-hover">Update forecast</button>
              {whatIf ? <Link href={`/app/forecast?days=${days}`} className="py-2 text-sm text-muted hover:text-fg">Clear</Link> : null}
            </form>
            {oneOffError ? <p role="alert" className="mt-2 text-sm text-neg-text">{oneOffError}</p> : null}
          </section>

          <section aria-labelledby="sched" className="mt-12">
            <h2 id="sched" className="mb-3 font-semibold">Scheduled items included</h2>
            {upcoming.length === 0 ? <p className="text-sm text-muted">No bills, subscriptions, income or debt payments are scheduled in this period.</p> : (
              <ul className="divide-y divide-line border-y border-line text-sm">
                {upcoming.map((e, i) => (
                  <li key={i} className="flex justify-between gap-3 py-2.5">
                    <span>{e.label} <span className="text-xs text-muted">· {e.date <= basis.today ? "overdue, assumed next day" : formatDay(e.date)}{e.nature === "estimate" ? " · estimate from your terms" : ""}</span></span>
                    <Money minor={e.amount} currency={c} signed className={e.amount > 0 ? "text-pos-text" : ""} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="assume" className="mt-12">
            <h2 id="assume" className="mb-3 font-semibold">Assumptions and limits</h2>
            <ul className="max-w-[68ch] list-disc space-y-2 pl-5 text-sm text-muted">
              <li>Starting cash is the total of your savings, current, cash and wallet accounts ({basis.accountNames.join(", ")}). Investments and cards are not included.</li>
              <li>Everyday spending is assumed to continue at <Money minor={result.dailyVariable} currency={c} className="text-fg" /> a day, taken from the last {basis.basisDays} days of your spending with recurring bills removed.{cover !== null ? ` At that rate today's cash covers about ${cover} days of everyday spending on its own.` : ""}</li>
              <li>Bills, subscriptions and expected income appear on their scheduled dates. Unpaid items past their date are assumed to happen tomorrow.</li>
              <li>Debt minimum payments use the due day and minimum you entered.</li>
              <li>Confidence: {CONF[basis.confidence]}. It does not allow for irregular spending, price changes or income that arrives late or not at all.</li>
            </ul>
          </section>
        </>
      )}
    </>
  );
}
