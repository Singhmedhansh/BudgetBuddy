import {
  emiBalanceByYear,
  growthByYear,
  type Calculation,
} from "./calculators";
import type { Facts } from "./grounding";

/**
 * Pictures for Finn's answers. They are built here, in code, from the same verified facts as the text, so a chart can
 * never show a number the person's records do not support. The model writes words; this file chooses the picture.
 */
/** Something Finn proposes to do. Nothing happens until the person taps Confirm; the server then checks everything again. */
export type FinnAction =
  | {
      kind: "add_transaction";
      type: "expense" | "income";
      amount: number;
      amountDisplay: string;
      accountId: string;
      accountName: string;
      categoryId: string;
      categoryName: string;
      date: string;
      merchant: string | null;
      clientKey: string;
      /** Save at once without a confirm tap (the person opted in). Set only on the live reply, never stored. */
      auto?: boolean;
    }
  | {
      kind: "set_budget_limit";
      budgetId: string;
      budgetName: string;
      categoryId: string;
      categoryName: string;
      amount: number;
      amountDisplay: string;
      previousDisplay: string | null;
    };

export type Tone = "ok" | "warn" | "bad" | "neutral";
export type Visual =
  | {
      type: "stats";
      title?: string;
      items: { label: string; value: string; tone?: Tone; hint?: string }[];
    }
  | {
      type: "donut";
      title: string;
      center?: { value: string; label: string };
      items: { label: string; value: number; display: string }[];
    }
  | {
      type: "bars";
      title: string;
      items: { label: string; value: number; display: string; tone?: Tone }[];
    }
  | {
      type: "columns";
      title: string;
      series: string[];
      groups: { label: string; values: number[]; display: string[] }[];
    }
  | {
      type: "line";
      title: string;
      xLabels: string[];
      yTicks: { value: number; label: string }[];
      series: {
        name: string;
        points: number[];
        dashed?: boolean;
        end: string;
      }[];
    }
  | {
      type: "progress";
      title: string;
      items: {
        label: string;
        value: number;
        max: number;
        display: string;
        note?: string;
        tone?: Tone;
      }[];
    }
  | { type: "action"; action: FinnAction }
  | {
      type: "timeline";
      title: string;
      items: {
        date: string;
        label: string;
        display: string;
        state: string;
        tone?: Tone;
      }[];
    };

const n = (v: string | number | undefined | null) =>
  v === undefined || v === null ? 0 : Number(v);

function formatter(currency: string) {
  const full = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  const compact = new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return {
    money: (v: string | number) => full.format(n(v)),
    compact: (v: number) => compact.format(v),
  };
}

/** Four round axis ticks from 0 up to just above the largest value. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step)
    out.push(Math.round(v * 100) / 100);
  return out.length > 1 ? out : [0, step];
}

const toneFor = (ratio: number): Tone =>
  ratio >= 1 ? "bad" : ratio >= 0.8 ? "warn" : "ok";

export function buildVisuals(question: string, facts: Facts): Visual[] {
  const q = question.toLowerCase();
  const { money, compact } = formatter(facts.space.currency);
  const out: Visual[] = [];
  const add = (v: Visual | null) => v && out.push(v);

  // 1. A what-if with its own numbers.
  if (facts.calculation)
    return calculationVisuals(facts.calculation, money, compact);

  // 1b. A what-if on their own spending.
  if (facts.scenario) {
    const c = facts.scenario;
    add({
      type: "stats",
      items: [
        { label: `Cut ${c.what} by`, value: `${c.percent}%` },
        {
          label: "You keep each month",
          value: money(c.savesPerMonth),
          tone: "ok",
        },
        { label: "Over a year", value: money(c.savesPerYear), tone: "ok" },
      ],
    });
    add({
      type: "bars",
      title: `${c.what}: now and after the cut`,
      items: [
        {
          label: "Usual month",
          value: n(c.usualMonthly),
          display: money(c.usualMonthly),
        },
        {
          label: `After a ${c.percent}% cut`,
          value: n(c.newMonthly),
          display: money(c.newMonthly),
          tone: "ok",
        },
      ],
    });
    if (c.monthlySavingNow && c.monthlySavingAfter)
      add({
        type: "bars",
        title: "What you save each month",
        items: [
          {
            label: "Now",
            value: Math.max(0, n(c.monthlySavingNow)),
            display: money(c.monthlySavingNow),
          },
          {
            label: "After the cut",
            value: Math.max(0, n(c.monthlySavingAfter)),
            display: money(c.monthlySavingAfter),
            tone: "ok",
          },
        ],
      });
    return out;
  }

  // 2. Saving for something.
  if (facts.savingsPlan) {
    const p = facts.savingsPlan;
    const target = n(p.target);
    const have = n(p.spendableNow);
    add({
      type: "progress",
      title: "Where you are against the target",
      items: [
        {
          label: "In everyday accounts now",
          value: Math.min(have, target),
          max: target,
          display: `${money(have)} of ${money(target)}`,
          tone: have >= target ? "ok" : "warn",
        },
      ],
    });
    add({
      type: "stats",
      items: [
        { label: "Target", value: money(target) },
        {
          label: "You save about",
          value: `${money(p.perMonth)}/mo`,
          tone: n(p.perMonth) > 0 ? "ok" : "bad",
        },
        {
          label: "Time to reach it",
          value: p.canAffordNow
            ? "Now"
            : p.months === null
              ? "Not at this pace"
              : `${p.months} ${p.months === 1 ? "month" : "months"}`,
          tone: p.canAffordNow ? "ok" : "neutral",
        },
      ],
    });
    return out;
  }

  if (
    /emergency|cushion|rainy|runway|how long could i|\blive on\b|months of (?:expenses|spending)|cover/.test(
      q,
    ) &&
    facts.emergencyFund
  ) {
    const e = facts.emergencyFund;
    const held = e.monthsHeld ?? 0;
    add({
      type: "stats",
      items: [
        { label: "3 months of spending", value: money(e.threeMonths) },
        { label: "6 months of spending", value: money(e.sixMonths) },
        {
          label: "You hold",
          value: e.monthsHeld === null ? "n/a" : `${e.monthsHeld} months`,
          tone: held >= 6 ? "ok" : held >= 3 ? "warn" : "bad",
        },
      ],
    });
    add({
      type: "progress",
      title: "Your cushion against a 6-month goal",
      items: [
        {
          label: "Months of spending covered",
          value: Math.min(held, 6),
          max: 6,
          display: `${held} of 6 months`,
          tone: held >= 6 ? "ok" : held >= 3 ? "warn" : "bad",
        },
      ],
    });
    return out;
  }

  if (
    /50\s*[/-]\s*30\s*[/-]\s*20|50-30-20|needs.*wants/.test(q) &&
    facts.rule503020
  ) {
    const r = facts.rule503020;
    add({
      type: "donut",
      title: `The 50/30/20 split of ${money(r.basisIncome)} a month`,
      center: { value: money(r.basisIncome), label: "monthly income" },
      items: [
        { label: "Needs 50%", value: n(r.needs), display: money(r.needs) },
        { label: "Wants 30%", value: n(r.wants), display: money(r.wants) },
        {
          label: "Savings 20%",
          value: n(r.savings),
          display: money(r.savings),
        },
      ],
    });
    return out;
  }

  if (
    /budget|limit|over budget|on track|stay within/.test(q) &&
    facts.budgets.length > 0
  ) {
    const lines = facts.budgets
      .flatMap((b) => b.lines)
      .filter((l) => n(l.limit) > 0);
    if (lines.length) {
      add({
        type: "progress",
        title: "Spent against each budget this month",
        items: lines
          .map((l) => ({ l, ratio: n(l.spent) / n(l.limit) }))
          .sort((a, b) => b.ratio - a.ratio)
          .slice(0, 7)
          .map(({ l, ratio }) => ({
            label: l.category,
            value: Math.min(n(l.spent), n(l.limit)),
            max: n(l.limit),
            display: `${money(l.spent)} of ${money(l.limit)}`,
            note:
              n(l.overBy) > 0
                ? `${money(l.overBy)} over`
                : `${money(l.remaining)} left`,
            tone: toneFor(ratio),
          })),
      });
    }
    if (out.length) return out;
  }

  if (/goal/.test(q) && facts.goals && facts.goals.length > 0) {
    add({
      type: "progress",
      title: "Savings goals",
      items: facts.goals.map((g) => ({
        label: g.name,
        value: n(g.saved),
        max: Math.max(1, n(g.target)),
        display: `${money(g.saved)} of ${money(g.target)}`,
        note: g.monthlyNeeded
          ? `${money(g.monthlyNeeded)}/mo needed`
          : g.deadline
            ? `by ${g.deadline}`
            : undefined,
        tone:
          g.health === "behind"
            ? "bad"
            : g.health === "complete"
              ? "ok"
              : "neutral",
      })),
    });
    return out;
  }

  if (
    /bill|due|upcoming|subscri|renew/.test(q) &&
    ((facts.bills && facts.bills.length > 0) || facts.subscriptions)
  ) {
    if (facts.bills && facts.bills.length > 0)
      add({
        type: "timeline",
        title: "Coming up in the next 30 days",
        items: facts.bills.map((b) => ({
          date: b.due,
          label: b.name,
          display: money(b.amount),
          state: b.state,
          tone:
            b.state === "overdue"
              ? "bad"
              : b.state === "due soon"
                ? "warn"
                : "neutral",
        })),
      });
    if (facts.subscriptions)
      add({
        type: "stats",
        items: [
          {
            label: "Active subscriptions",
            value: String(facts.subscriptions.active),
          },
          {
            label: "Per month",
            value: money(facts.subscriptions.monthlyTotal),
          },
          {
            label: "Per year",
            value: money(facts.subscriptions.yearlyTotal),
            tone: "warn",
          },
        ],
      });
    return out;
  }

  if (
    /net worth|worth|account|balance|owe|debt|loan|asset/.test(q) &&
    facts.accounts.length > 0
  ) {
    add({
      type: "stats",
      items: [
        { label: "You hold", value: money(facts.held), tone: "ok" },
        {
          label: "You owe",
          value: money(facts.owed),
          tone: n(facts.owed) > 0 ? "bad" : "neutral",
        },
        {
          label: "Net worth",
          value: money(facts.netWorth),
          tone: n(facts.netWorth) >= 0 ? "ok" : "bad",
        },
      ],
    });
    const rows = facts.accounts
      .filter((a) => n(a.balance) !== 0)
      .sort((a, b) => Math.abs(n(b.balance)) - Math.abs(n(a.balance)))
      .slice(0, 8);
    if (rows.length > 1)
      add({
        type: "bars",
        title: "Balance by account",
        items: rows.map((a) => ({
          label: a.name,
          value: Math.abs(n(a.balance)),
          display: money(a.balance),
          tone: /credit|liabil|loan/i.test(a.type) ? "bad" : "neutral",
        })),
      });
    return out;
  }

  // "How much can I spend per day" is about pace, not about where the money went.
  const paceQ =
    /per day|daily|pace|projected|month.?end|on pace|rest of the month/.test(q);
  const spendy =
    !paceQ &&
    /spend|spent|categor|where.*(money|go|went)|biggest|expens|food|top\b|cut back|payee|merchant|shop/.test(
      q,
    );
  const trendy =
    /income|trend|history|compare|last month|months|saving|save|rate|earn|net\b/.test(
      q,
    );
  if (
    spendy &&
    facts.categories &&
    facts.categories.some((c) => n(c.thisMonth) > 0)
  ) {
    const cats = facts.categories.filter((c) => n(c.thisMonth) > 0);
    const total = n(facts.thisMonth.spending);
    add({
      type: "donut",
      title: `Where your money went in ${facts.thisMonth.label}`,
      center: { value: money(total), label: "spent so far" },
      items: cats.slice(0, 6).map((c) => ({
        label: c.name,
        value: n(c.thisMonth),
        display: money(c.thisMonth),
      })),
    });
    const risen = [...cats]
      .filter((c) => c.changePercent !== null && c.changePercent >= 15)
      .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
      .slice(0, 5);
    if (risen.length)
      add({
        type: "bars",
        title: "Biggest increases against last month",
        items: risen.map((c) => ({
          label: `${c.name} (+${c.changePercent}%)`,
          value: n(c.thisMonth) - n(c.lastMonth),
          display: `+${money(n(c.thisMonth) - n(c.lastMonth))}`,
          tone: "warn",
        })),
      });
    return out;
  }
  if ((trendy || spendy) && facts.history && facts.history.length >= 2) {
    add({
      type: "columns",
      title: "Income and spending by month",
      series: ["Income", "Spending"],
      groups: facts.history.map((h) => ({
        label: h.label.replace(/\s\d{4}$/, ""),
        values: [n(h.income), n(h.spending)],
        display: [money(h.income), money(h.spending)],
      })),
    });
    if (facts.pace)
      add({
        type: "stats",
        items: [
          {
            label: "Saved this month",
            value: money(facts.thisMonth.net),
            tone: n(facts.thisMonth.net) >= 0 ? "ok" : "bad",
          },
          {
            label: "Savings rate",
            value:
              facts.pace.savingsRatePercent === null
                ? "n/a"
                : `${facts.pace.savingsRatePercent}%`,
          },
          {
            label: "Usual monthly saving",
            value: facts.monthlyNet ? money(facts.monthlyNet.amount) : "n/a",
          },
        ],
      });
    return out;
  }
  if (
    /per day|daily|pace|projected|month.?end|on pace|rest of the month/.test(
      q,
    ) &&
    facts.pace
  ) {
    add({
      type: "stats",
      items: [
        { label: "Spent so far", value: money(facts.thisMonth.spending) },
        { label: "Daily average", value: money(facts.pace.dailyAverage) },
        {
          label: "On pace for",
          value: money(facts.pace.projectedMonthEnd),
          tone: "warn",
          hint: `${facts.pace.daysLeft} days left`,
        },
      ],
    });
  }
  return out;
}

function calculationVisuals(
  c: Calculation,
  money: (v: string | number) => string,
  compact: (v: number) => string,
): Visual[] {
  const out: Visual[] = [];
  if (c.kind === "emi") {
    out.push({
      type: "stats",
      items: [
        {
          label: "Monthly payment",
          value: money(c.monthlyPayment),
          tone: "ok",
        },
        {
          label: "Total interest",
          value: money(c.totalInterest),
          tone: "warn",
        },
        { label: "Total you repay", value: money(c.totalPaid) },
      ],
    });
    out.push({
      type: "donut",
      title: "Where your repayments go",
      center: { value: money(c.totalPaid), label: "total repaid" },
      items: [
        {
          label: "Principal",
          value: n(c.loanAmount),
          display: money(c.loanAmount),
        },
        {
          label: "Interest",
          value: n(c.totalInterest),
          display: money(c.totalInterest),
        },
      ],
    });
    const bal = emiBalanceByYear(n(c.loanAmount), c.ratePercent, c.months);
    const ticks = niceTicks(n(c.loanAmount));
    out.push({
      type: "line",
      title: "What you still owe, year by year",
      xLabels: bal.map((_, i) => (i === 0 ? "Start" : `Yr ${i}`)),
      yTicks: ticks.map((v) => ({ value: v, label: compact(v) })),
      series: [
        {
          name: "Outstanding loan",
          points: bal,
          end: money(bal[bal.length - 1]),
        },
      ],
    });
    return out;
  }
  const isSip = c.kind === "sip";
  const total = isSip ? n(c.futureValue) : n(c.futureValue);
  const series = growthByYear(
    isSip
      ? {
          kind: "sip",
          monthly: n(c.monthlyInvestment),
          ratePercent: c.ratePercent,
          years: c.years,
        }
      : {
          kind: "lumpsum",
          amount: n(c.amount),
          ratePercent: c.ratePercent,
          years: c.years,
        },
  );
  out.push({
    type: "stats",
    items: isSip
      ? [
          { label: "You invest", value: money(c.totalInvested) },
          {
            label: "Estimated gain",
            value: money(c.estimatedGain),
            tone: "ok",
          },
          { label: "Could grow to", value: money(c.futureValue), tone: "ok" },
        ]
      : [
          { label: "You put in", value: money(c.amount) },
          {
            label: "Estimated gain",
            value: money(c.estimatedGain),
            tone: "ok",
          },
          { label: "Could grow to", value: money(c.futureValue), tone: "ok" },
        ],
  });
  out.push({
    type: "line",
    title: `Growth at ${c.ratePercent}% a year (an assumption, not a promise)`,
    xLabels: series.invested.map((_, i) => (i === 0 ? "Start" : `Yr ${i}`)),
    yTicks: niceTicks(total).map((v) => ({ value: v, label: compact(v) })),
    series: [
      {
        name: "Estimated value",
        points: series.value,
        end: money(series.value[series.value.length - 1]),
      },
      {
        name: isSip ? "Total invested" : "Amount put in",
        points: series.invested,
        dashed: true,
        end: money(series.invested[series.invested.length - 1]),
      },
    ],
  });
  return out;
}
