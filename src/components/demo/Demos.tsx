"use client";

import { useState } from "react";
import { useCountUp } from "@/components/motion/CountUp";
import { Bar, BALANCE, Ring, rs, Sparkline } from "./parts";

const level = (pct: number) => (pct >= 100 ? "over" : pct >= 80 ? "warn" : "ok") as "ok" | "warn" | "over";

/* ---------- Dashboard ---------- */
export function DashboardDemo() {
  const net = useCountUp(247_320);
  return (
    <div className="p-5 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Net worth" value={rs(net)} sub="+₹5,120 this week" tone="pos" />
        <Tile label="Income this month" value={rs(95_000)} sub="Salary received" tone="pos" />
        <Tile label="Spending this month" value={rs(41_680)} sub="Transfers not counted" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-lg border border-line p-4">
          <p className="text-sm font-medium">Balance over 30 days</p>
          <Sparkline data={BALANCE} className="mt-2" />
        </div>
        <div className="rounded-lg border border-line p-4">
          <p className="text-sm font-medium">Budget watch</p>
          <ul className="mt-3 space-y-3 text-xs">
            {(
              [
                ["Groceries", 72],
                ["Dining", 91],
                ["Transport", 48],
              ] as const
            ).map(([n, p], i) => (
              <li key={n}>
                <div className="mb-1 flex justify-between">
                  <span>{n}</span>
                  <span className="num text-muted">{p}%</span>
                </div>
                <Bar pct={p} tone={level(p)} delay={i * 90} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "pos" }) {
  return (
    <div className="rounded-lg border border-line p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`num mt-1 text-xl font-semibold ${tone === "pos" ? "text-pos-text" : ""}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{sub}</p>
    </div>
  );
}

/* ---------- Transactions ---------- */
interface Tx {
  id: number;
  name: string;
  cat: string;
  amount: number;
  fresh?: boolean;
}
const QUEUE: Omit<Tx, "id">[] = [
  { name: "Fresh Basket", cat: "Groceries", amount: -1_842 },
  { name: "Metro card top-up", cat: "Transport", amount: -500 },
  { name: "Freelance payment", cat: "Income", amount: 12_000 },
  { name: "Chai and snacks", cat: "Dining", amount: -240 },
];
const START: Tx[] = [
  { id: -1, name: "Salary", cat: "Income", amount: 95_000 },
  { id: -2, name: "Rent", cat: "Housing", amount: -22_000 },
  { id: -3, name: "Streamly", cat: "Subscriptions", amount: -299 },
];

export function TransactionsDemo() {
  const [rows, setRows] = useState<Tx[]>(START);
  const [n, setN] = useState(0);
  const balance = 124_000 + rows.reduce((s, r) => s + r.amount, 0) - START.reduce((s, r) => s + r.amount, 0);
  const next = QUEUE[n % QUEUE.length];
  return (
    <div className="p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted">Bank balance</p>
          <p className="num text-2xl font-semibold" aria-live="polite">
            {rs(balance)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setRows((r) => [{ ...next, id: n, fresh: true }, ...r.map((x) => ({ ...x, fresh: false }))].slice(0, 6));
            setN((v) => v + 1);
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
        >
          Add {next.name}, {rs(Math.abs(next.amount))}
        </button>
      </div>
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line" aria-label="Sample transactions">
        {rows.map((t) => (
          <li key={t.id} className={`flex items-center justify-between gap-4 px-4 py-3 ${t.fresh ? "anim-slide" : ""}`}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{t.name}</p>
              <p className="text-xs text-muted">{t.cat}</p>
            </div>
            <span className={`num text-sm ${t.amount > 0 ? "text-pos-text" : ""}`}>
              {t.amount > 0 ? "+" : "-"}
              {rs(Math.abs(t.amount))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Press the button to record a sample transaction. The balance follows the ledger entry.</p>
    </div>
  );
}

/* ---------- Budgets ---------- */
export function BudgetsDemo() {
  const [dining, setDining] = useState(7_300);
  const cats = [
    { n: "Groceries", spent: 8_640, limit: 12_000 },
    { n: "Dining", spent: dining, limit: 8_000 },
    { n: "Transport", spent: 2_410, limit: 5_000 },
    { n: "Entertainment", spent: 1_150, limit: 3_000 },
  ];
  return (
    <div className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">November budget</p>
        <button type="button" onClick={() => setDining((d) => (d >= 9_000 ? 7_300 : d + 900))} className="rounded-md border border-line-strong px-3 py-1.5 text-sm transition-colors hover:border-primary">
          {dining >= 9_000 ? "Reset" : "Spend ₹900 on dining"}
        </button>
      </div>
      <ul className="mt-4 space-y-4">
        {cats.map((c, i) => {
          const pct = Math.round((c.spent / c.limit) * 100);
          const lv = level(pct);
          return (
            <li key={c.n}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{c.n}</span>
                <span className={`num text-right text-xs ${lv === "over" ? "text-neg-text" : lv === "warn" ? "text-warn-text" : "text-muted"}`}>
                  {rs(c.spent)} of {rs(c.limit)}, {lv === "over" ? `over by ${rs(c.spent - c.limit)}` : `${rs(c.limit - c.spent)} left`}
                </span>
              </div>
              <Bar pct={pct} tone={lv} delay={i * 80} />
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-muted">Bars turn amber near the limit and red when over, with the amount in words, so colour is never the only signal.</p>
    </div>
  );
}

/* ---------- Goals ---------- */
export function GoalsDemo() {
  const [saved, setSaved] = useState(68_000);
  const target = 120_000;
  const pct = Math.round((saved / target) * 100);
  return (
    <div className="grid items-center gap-6 p-5 sm:grid-cols-[auto_1fr] sm:p-8">
      <div className="mx-auto">
        <Ring pct={pct} size={132} stroke={11}>
          {pct}%
        </Ring>
      </div>
      <div>
        <p className="text-xs text-muted">Goal</p>
        <p className="text-xl font-semibold">Emergency fund</p>
        <p className="num mt-1 text-sm text-muted">
          {rs(saved)} of {rs(target)}
        </p>
        <div className="mt-4">
          <Bar pct={pct} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setSaved((s) => Math.min(target, s + 5_000))} disabled={saved >= target} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-50">
            Add ₹5,000
          </button>
          <button type="button" onClick={() => setSaved(68_000)} className="rounded-md border border-line-strong px-3 py-2 text-sm hover:border-primary">
            Reset
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">{saved >= target ? "Goal reached." : `At ${rs(10_000)} a month you would reach it in about ${Math.ceil((target - saved) / 10_000)} months.`}</p>
      </div>
    </div>
  );
}

/* ---------- Analytics ---------- */
const MONTHS = [
  ["Jun", 38],
  ["Jul", 44],
  ["Aug", 41],
  ["Sep", 52],
  ["Oct", 47],
  ["Nov", 42],
] as const;
const SHARES = [
  ["Housing", 38, "var(--primary)"],
  ["Food", 24, "var(--info)"],
  ["Transport", 14, "var(--warn)"],
  ["Subscriptions", 9, "var(--neg)"],
  ["Other", 15, "var(--line-strong)"],
] as const;

export function AnalyticsDemo() {
  const max = 60;
  return (
    <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="rounded-lg border border-line p-4">
        <p className="text-sm font-medium">
          Spending, last 6 months <span className="text-xs font-normal text-muted">(₹ thousands)</span>
        </p>
        <svg viewBox="0 0 300 130" className="mt-3 h-auto w-full" role="img" aria-label="Monthly spending: Jun 38, Jul 44, Aug 41, Sep 52, Oct 47, Nov 42 thousand rupees">
          {MONTHS.map(([m, v], i) => {
            const h = (v / max) * 100;
            return (
              <g key={m}>
                <rect x={14 + i * 48} y={108 - h} width="28" height={h} rx="5" fill={m === "Nov" ? "var(--primary)" : "var(--sage)"} className="anim-rise" style={{ animationDelay: `${i * 70}ms` }} />
                <text x={28 + i * 48} y="124" textAnchor="middle" fontSize="10" fill="var(--muted)">
                  {m}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="rounded-lg border border-line p-4">
        <p className="text-sm font-medium">Where it went</p>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full" role="presentation">
          {SHARES.map(([n, p, c]) => (
            <i key={n} style={{ width: `${p}%`, background: c }} />
          ))}
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {SHARES.map(([n, p, c]) => (
            <li key={n} className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <i className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                {n}
              </span>
              <span className="num text-muted">{p}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------- Calendar ---------- */
const BILLS: Record<number, [string, number][]> = {
  3: [["Rent", 22_000]],
  8: [["Streamly", 299]],
  15: [["Credit card", 6_400]],
  21: [["Internet", 999]],
  28: [["Insurance", 2_150]],
};

export function CalendarDemo() {
  const [sel, setSel] = useState(15);
  const days = Array.from({ length: 30 }, (_, i) => i + 1);
  // 1 November 2026 is a Sunday, so the grid starts in the first column.
  return (
    <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <p className="mb-2 text-sm font-medium">November 2026</p>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted" aria-hidden>
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {days.map((d) => (
            <button key={d} type="button" onClick={() => setSel(d)} aria-pressed={sel === d} aria-label={`${d} November${BILLS[d] ? `, ${BILLS[d].length} due` : ""}`} className={`relative grid aspect-square place-items-center rounded-md text-xs transition-colors ${sel === d ? "bg-primary font-semibold text-primary-fg" : "hover:bg-sunken"}`}>
              {d}
              {BILLS[d] ? <i className={`absolute bottom-1 h-1 w-1 rounded-full ${sel === d ? "bg-primary-fg" : "bg-primary"}`} /> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-line p-4">
        <p className="text-sm font-medium">{sel} Nov</p>
        {BILLS[sel] ? (
          <ul className="mt-3 space-y-2">
            {BILLS[sel].map(([n, a]) => (
              <li key={`${sel}-${n}`} className="anim-pop flex justify-between text-sm">
                <span>{n}</span>
                <span className="num">{rs(a)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">Nothing due this day.</p>
        )}
        <p className="mt-5 border-t border-line pt-3 text-xs text-muted">
          Due this month: <span className="num font-medium text-fg">{rs(31_848)}</span>
        </p>
      </div>
    </div>
  );
}
