import { shares } from "@/domain/analytics";
import { periodTotals, spendingByCategory, type LedgerAccount } from "@/domain/ledger";
import { toDecimalString } from "@/domain/money";
import { localDate, monthRange } from "@/domain/period";
import type { requireSpace } from "@/server/context";
import { currentMonth, listAccounts, listBudgets, listCategories, postingsInRange } from "@/server/queries";
import { ACCOUNT_TYPE_LABEL, isLiability } from "@/server/types";
import { clean, type Facts } from "./grounding";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

/**
 * The verified figures the assistant may use, computed by the same ledger code as the dashboard (transfers are not
 * spending, reversals offset, refunds net off). Nothing here is estimated, and no transaction detail is included.
 */
export async function loadFacts(ctx: Ctx): Promise<Facts> {
  const { space, profile } = ctx;
  const cur = space.currency;
  const dec = (minor: number) => toDecimalString(minor, cur);
  const month = await currentMonth(ctx);
  const [accounts, budgets, cats] = await Promise.all([listAccounts(ctx), listBudgets(ctx), listCategories(ctx)]);
  const { postings, kinds } = await postingsInRange(ctx, month.from, month.to);
  const ledger: LedgerAccount[] = [...kinds].map(([id, kind]) => ({ id, kind, currency: cur }));
  const totals = periodTotals(ledger, postings, month.from, month.to);
  const byCat = spendingByCategory(ledger, postings, month.from, month.to);
  const names = new Map(cats.map((c) => [c.id, c.name]));
  const top = shares([...byCat].map(([id, amount]) => ({ key: names.get(id) ?? "Other", amount })))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // The last three full months, for "how long to save for X": income minus spending, averaged by code.
  let monthlyNet: Facts["monthlyNet"];
  {
    const nets: number[] = [];
    const ranges = [1, 2, 3].map((back) => {
      const d = new Date(Date.UTC(month.year, month.month - 1 - back, 1));
      return monthRange(d.getUTCFullYear(), d.getUTCMonth() + 1, profile.timezone);
    });
    const earlier = await postingsInRange(ctx, ranges[2].from, ranges[0].to);
    const earlierLedger: LedgerAccount[] = [...earlier.kinds].map(([id, kind]) => ({ id, kind, currency: cur }));
    for (const r of ranges) {
      const t = periodTotals(earlierLedger, earlier.postings, r.from, r.to);
      if (t.income > 0 || t.expenses > 0) nets.push(t.income - t.expenses);
    }
    if (nets.length) monthlyNet = { amount: dec(Math.round(nets.reduce((a, b) => a + b, 0) / nets.length)), months: nets.length };
    else if (totals.income > 0 || totals.expenses > 0) monthlyNet = { amount: dec(totals.income - totals.expenses), months: 1 };
  }

  const held = accounts.filter((a) => !isLiability(a.type)).reduce((s, a) => s + a.balance, 0);
  const owed = accounts.filter((a) => isLiability(a.type)).reduce((s, a) => s + a.balance, 0);
  const today = localDate(new Date(), profile.timezone);
  return {
    asOf: `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`,
    space: { name: clean(space.name), currency: cur, sample: Boolean(space.is_sample) },
    netWorth: dec(held - owed),
    monthlyNet,
    held: dec(held),
    owed: dec(owed),
    accounts: accounts.slice(0, 15).map((a) => ({ name: clean(a.name), type: ACCOUNT_TYPE_LABEL[a.type], balance: dec(a.balance) })),
    thisMonth: {
      label: new Intl.DateTimeFormat("en-IN", { timeZone: profile.timezone, month: "long", year: "numeric" }).format(month.from),
      income: dec(totals.income),
      spending: dec(totals.expenses),
      net: dec(totals.income - totals.expenses),
      keptPercent: totals.income > 0 ? Math.max(0, Math.round(((totals.income - totals.expenses) / totals.income) * 100)) : null,
    },
    topCategories: top.map((t) => ({ name: clean(t.key), amount: dec(t.amount), percent: t.percent })),
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
