import { merchantTotals, percentChange, shares } from "@/domain/analytics";
import { periodTotals, spendingByCategory, type LedgerAccount } from "@/domain/ledger";
import { toDecimalString } from "@/domain/money";
import { localDate, monthRange } from "@/domain/period";
import type { requireSpace } from "@/server/context";
import { listDebts, listGoals, listRecurring, todayFor } from "@/server/planning";
import { currentMonth, listAccounts, listBudgets, listCategories, listTransactions, postingsInRange } from "@/server/queries";
import { ACCOUNT_TYPE_LABEL, isLiability } from "@/server/types";
import { clean, type Facts } from "./grounding";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

const SPENDABLE = new Set(["savings", "current", "cash", "wallet"]);
const DAY = 86_400_000;

/** A section that fails to load is left out; Finn still answers from the rest. */
async function soft<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch {
    return undefined;
  }
}

/**
 * The verified figures Finn may use, computed by the same ledger code as the dashboard (transfers are not
 * spending, reversals offset, refunds net off). Everything a question could need is worked out here, in code, so the
 * model never has to do arithmetic: six months of history, how categories and payees moved, the pace of this month,
 * bills, goals and debts.
 */
export async function loadFacts(ctx: Ctx): Promise<Facts> {
  const { space, profile } = ctx;
  const cur = space.currency;
  const dec = (minor: number) => toDecimalString(minor, cur);
  const month = await currentMonth(ctx);
  const [accounts, budgets, cats] = await Promise.all([listAccounts(ctx), listBudgets(ctx), listCategories(ctx)]);

  // Six months of postings in one read: the current month and the five before it.
  const ranges = [5, 4, 3, 2, 1, 0].map((back) => {
    const d = new Date(Date.UTC(month.year, month.month - 1 - back, 1));
    return monthRange(d.getUTCFullYear(), d.getUTCMonth() + 1, profile.timezone);
  });
  const { postings, kinds } = await postingsInRange(ctx, ranges[0].from, ranges[5].to);
  const ledger: LedgerAccount[] = [...kinds].map(([id, kind]) => ({ id, kind, currency: cur }));
  const perMonth = ranges.map((r) => ({ range: r, totals: periodTotals(ledger, postings, r.from, r.to), byCat: spendingByCategory(ledger, postings, r.from, r.to) }));
  const now = perMonth[5];
  const last = perMonth[4];
  const totals = now.totals;
  const names = new Map(cats.map((c) => [c.id, c.name]));
  const label = (d: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: profile.timezone, month: "short", year: "numeric" }).format(d);

  const top = shares([...now.byCat].map(([id, amount]) => ({ key: names.get(id) ?? "Other", amount })))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const history = perMonth.filter((m) => m.totals.income > 0 || m.totals.expenses > 0).map((m) => ({ label: label(m.range.from), income: dec(m.totals.income), spending: dec(m.totals.expenses), net: dec(m.totals.income - m.totals.expenses) }));

  // The last three full months, for "how long to save for X": income minus spending, averaged by code.
  const completed = [perMonth[4], perMonth[3], perMonth[2]].filter((m) => m.totals.income > 0 || m.totals.expenses > 0);
  let monthlyNet: Facts["monthlyNet"];
  if (completed.length) monthlyNet = { amount: dec(Math.round(completed.reduce((s, m) => s + (m.totals.income - m.totals.expenses), 0) / completed.length)), months: completed.length };
  else if (totals.income > 0 || totals.expenses > 0) monthlyNet = { amount: dec(totals.income - totals.expenses), months: 1 };

  // Categories: this month against last month and the three-month average.
  const catIds = new Set([...now.byCat.keys(), ...last.byCat.keys()]);
  const categories: NonNullable<Facts["categories"]> = [...catIds]
    .map((id) => {
      const thisM = now.byCat.get(id) ?? 0;
      const lastM = last.byCat.get(id) ?? 0;
      const avg = Math.round([perMonth[4], perMonth[3], perMonth[2]].reduce((s, m) => s + (m.byCat.get(id) ?? 0), 0) / 3);
      const change = percentChange(thisM, lastM);
      return { id, thisM, lastM, avg, change };
    })
    .filter((c) => c.thisM > 0 || c.lastM > 0)
    .sort((a, b) => b.thisM - a.thisM)
    .slice(0, 8)
    .map((c) => ({ name: clean(names.get(c.id) ?? "Other"), thisMonth: dec(c.thisM), lastMonth: dec(c.lastM), changePercent: c.change === null ? null : Math.round(c.change), avg3m: dec(c.avg) }));

  const held = accounts.filter((a) => !isLiability(a.type)).reduce((s, a) => s + a.balance, 0);
  const owed = accounts.filter((a) => isLiability(a.type)).reduce((s, a) => s + a.balance, 0);
  const spendable = accounts.filter((a) => SPENDABLE.has(a.type)).reduce((s, a) => s + a.balance, 0);
  const today = localDate(new Date(), profile.timezone);
  const todayIso = todayFor(ctx);

  // Pace of this month, from the spending so far.
  const daysInMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  const daysElapsed = Math.max(1, Math.min(daysInMonth, today.day));
  const daysLeft = daysInMonth - daysElapsed;
  const budgetLeft = budgets.reduce((s, b) => s + Math.max(0, b.total.remaining), 0);
  const avgSpend = completed.length ? Math.round(completed.reduce((s, m) => s + m.totals.expenses, 0) / completed.length) : 0;
  const pace: Facts["pace"] = {
    daysElapsed,
    daysLeft,
    dailyAverage: dec(Math.round(totals.expenses / daysElapsed)),
    projectedMonthEnd: dec(Math.round((totals.expenses / daysElapsed) * daysInMonth)),
    budgetLeftPerDay: budgets.length && daysLeft > 0 ? dec(Math.round(budgetLeft / daysLeft)) : null,
    savingsRatePercent: totals.income > 0 ? Math.max(0, Math.round(((totals.income - totals.expenses) / totals.income) * 100)) : null,
    monthsOfCover: avgSpend > 0 ? Math.round((spendable / avgSpend) * 10) / 10 : null,
  };

  const [payees, bills, subscriptions, goals, debts] = await Promise.all([
    soft(async () => {
      const since = new Date(Date.now() - 90 * DAY);
      const txns = await listTransactions(ctx, { from: since, limit: 5000 });
      const toTxn = (t: (typeof txns)[number]) => ({ id: t.id, type: t.type, merchant: t.merchant, expenseAmount: t.expenseAmount, reversalOf: t.reversal_of, refundOf: t.refund_of });
      const recent = merchantTotals(txns.map(toTxn));
      const mine = new Map(merchantTotals(txns.filter((t) => new Date(t.occurred_at) >= now.range.from).map(toTxn)).map((m) => [m.merchant.toLowerCase(), m.amount]));
      return recent.slice(0, 10).map((m) => ({ name: clean(m.merchant), thisMonth: dec(mine.get(m.merchant.toLowerCase()) ?? 0), last90Days: dec(m.amount), visits90: m.count }));
    }),
    soft(async () => {
      const [b, s] = await Promise.all([listRecurring(ctx, "bill"), listRecurring(ctx, "subscription")]);
      const horizon = new Date(Date.parse(todayIso) + 30 * DAY).toISOString().slice(0, 10);
      return [...b, ...s]
        .filter((i) => i.status === "active" && i.due && i.due.date <= horizon)
        .sort((x, y) => x.due!.date.localeCompare(y.due!.date))
        .slice(0, 8)
        .map((i) => ({ name: clean(i.name), kind: i.kind as "bill" | "subscription", amount: dec(i.amount), due: i.due!.date, state: i.due!.state === "due_soon" ? "due soon" : i.due!.state }));
    }),
    soft(async () => {
      const subs = (await listRecurring(ctx, "subscription")).filter((i) => i.status === "active");
      return subs.length ? { active: subs.length, monthlyTotal: dec(Math.round(subs.reduce((s, i) => s + i.monthly, 0))), yearlyTotal: dec(Math.round(subs.reduce((s, i) => s + i.yearly, 0))) } : undefined;
    }),
    soft(async () =>
      (await listGoals(ctx))
        .filter((g) => g.status === "active")
        .slice(0, 6)
        .map((g) => ({ name: clean(g.name), target: dec(g.target), saved: dec(g.saved), remaining: dec(g.remaining), deadline: g.deadline, monthlyNeeded: g.monthlyTarget === null ? null : dec(Math.round(g.monthlyTarget)), health: g.health.replace("_", " ") })),
    ),
    soft(async () => (await listDebts(ctx)).filter((d) => d.owed > 0).slice(0, 5).map((d) => ({ name: clean(d.name), owed: dec(d.owed), ratePercent: d.rateBps === null ? null : Math.round(d.rateBps) / 100, minPayment: d.minPayment === null ? null : dec(d.minPayment) }))),
  ]);

  return {
    asOf: `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`,
    space: { name: clean(space.name), currency: cur, sample: Boolean(space.is_sample) },
    netWorth: dec(held - owed),
    spendable: dec(spendable),
    monthlyNet,
    held: dec(held),
    owed: dec(owed),
    accounts: accounts.slice(0, 15).map((a) => ({ name: clean(a.name), type: ACCOUNT_TYPE_LABEL[a.type], balance: dec(a.balance) })),
    thisMonth: {
      label: new Intl.DateTimeFormat("en-IN", { timeZone: profile.timezone, month: "long", year: "numeric" }).format(now.range.from),
      income: dec(totals.income),
      spending: dec(totals.expenses),
      net: dec(totals.income - totals.expenses),
      keptPercent: totals.income > 0 ? Math.max(0, Math.round(((totals.income - totals.expenses) / totals.income) * 100)) : null,
    },
    history,
    categories,
    topCategories: top.map((t) => ({ name: clean(t.key), amount: dec(t.amount), percent: t.percent })),
    payees,
    pace,
    bills,
    subscriptions,
    goals,
    debts,
    budgets: budgets.slice(0, 8).map((b) => ({
      name: clean(b.name),
      lines: b.lines.slice(0, 12).map((l) => ({
        category: clean(l.categoryName),
        limit: dec(l.status.allocated),
        spent: dec(l.status.actual),
        remaining: dec(Math.max(0, l.status.remaining)),
        overBy: dec(l.status.overBudget),
        state: l.level === "warning" ? "warning" : l.level,
      })),
    })),
  };
}
