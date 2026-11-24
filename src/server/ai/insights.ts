import type { Facts } from "./grounding";

export interface Insight {
  tone: "good" | "warn" | "info";
  text: string;
  /** The question to ask Finn about it. */
  ask: string;
}

const n = (v: string | number | undefined) => Number(v ?? 0);

/** What Finn noticed in this person's records, worked out in code. At most four, most important first. Pure. */
export function insightsFrom(f: Facts): Insight[] {
  const cur = f.space.currency;
  const fmt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: 0,
  });
  const m = (v: string | number) => fmt.format(n(v));
  const out: Insight[] = [];

  for (const b of f.budgets)
    for (const l of b.lines)
      if (n(l.overBy) > 0)
        out.push({
          tone: "warn",
          text: `${l.category} is ${m(l.overBy)} over its budget this month.`,
          ask: `Why am I over budget on ${l.category}?`,
        });
  for (const bill of f.bills ?? []) {
    if (bill.state === "overdue")
      out.push({
        tone: "warn",
        text: `${bill.name} (${m(bill.amount)}) is overdue.`,
        ask: "What bills are coming up?",
      });
    else if (bill.state === "due soon")
      out.push({
        tone: "info",
        text: `${bill.name} (${m(bill.amount)}) is due soon.`,
        ask: "What bills are coming up?",
      });
  }
  const risen = (f.categories ?? [])
    .filter(
      (c) =>
        c.changePercent !== null &&
        c.changePercent >= 25 &&
        n(c.lastMonth) > 0 &&
        n(c.thisMonth) - n(c.lastMonth) >= 500,
    )
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0];
  if (risen)
    out.push({
      tone: "warn",
      text: `${risen.name} is up ${risen.changePercent}% on last month (${m(risen.thisMonth)} against ${m(risen.lastMonth)}).`,
      ask: `Why is my ${risen.name} spending up?`,
    });
  if (f.history && f.history.length >= 3 && f.pace) {
    const done = f.history.slice(0, -1);
    const usual = done.reduce((s, h) => s + n(h.spending), 0) / done.length;
    if (
      usual > 0 &&
      n(f.pace.projectedMonthEnd) > usual * 1.15 &&
      f.pace.daysLeft > 3
    )
      out.push({
        tone: "warn",
        text: `You are on pace to spend ${m(f.pace.projectedMonthEnd)} this month, above your usual ${m(usual)}.`,
        ask: "How much can I spend per day this month?",
      });
  }
  if (
    f.pace?.savingsRatePercent !== null &&
    f.pace?.savingsRatePercent !== undefined &&
    n(f.thisMonth.income) > 0
  ) {
    if (f.pace.savingsRatePercent >= 20)
      out.push({
        tone: "good",
        text: `You are saving ${f.pace.savingsRatePercent}% of your income this month. That is a healthy rate.`,
        ask: "Where should my savings go?",
      });
    else if (f.pace.savingsRatePercent < 10)
      out.push({
        tone: "warn",
        text: `You are keeping only ${f.pace.savingsRatePercent}% of your income this month.`,
        ask: "Where could I cut back?",
      });
  }
  if (
    f.pace?.monthsOfCover !== null &&
    f.pace?.monthsOfCover !== undefined &&
    f.pace.monthsOfCover < 3
  )
    out.push({
      tone: "info",
      text: `Your everyday accounts cover about ${f.pace.monthsOfCover} months of spending. Three to six is the usual cushion.`,
      ask: "How big should my emergency fund be?",
    });
  if (f.subscriptions && f.subscriptions.active >= 3)
    out.push({
      tone: "info",
      text: `Your ${f.subscriptions.active} subscriptions cost ${m(f.subscriptions.yearlyTotal)} a year.`,
      ask: "How much do my subscriptions cost me a year?",
    });
  const goal = (f.goals ?? []).find((g) => g.health === "behind");
  if (goal)
    out.push({
      tone: "warn",
      text: `${goal.name} is behind schedule.`,
      ask: "How are my savings goals going?",
    });

  const rank = { warn: 0, info: 1, good: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 4);
}
