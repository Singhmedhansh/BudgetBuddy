import { formatMoney } from "@/domain/money";
import type { ForecastPoint } from "@/domain/forecast";

/** A projected balance line with a zero baseline, plus a weekly table equivalent. Marked as an estimate. */
export function BalanceChart({ points, currency }: { points: ForecastPoint[]; currency: string }) {
  const W = 560;
  const H = 200;
  const pad = { l: 8, r: 8, t: 10, b: 10 };
  const lo = Math.min(0, ...points.map((p) => p.balance));
  const hi = Math.max(1, ...points.map((p) => p.balance));
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
  const weekly = points.filter((_, i) => i % 7 === 0 || i === points.length - 1);
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Projected cash balance, an estimate. From ${formatMoney(first.balance, currency)} on ${first.date} to ${formatMoney(last.balance, currency)} on ${last.date}.`} className="h-auto w-full">
        {lo < 0 ? <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--neg)" strokeDasharray="4 4" /> : null}
        <path d={d} fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="6 3" strokeLinejoin="round" />
        <circle cx={x(0)} cy={y(first.balance)} r="3.5" fill="var(--fg)" />
      </svg>
      <figcaption className="mt-2 text-xs text-muted">The dashed line is an estimate. The dot is your actual balance today.</figcaption>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-primary">Show as a table</summary>
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Projected cash balance by week</caption>
          <thead><tr className="border-b border-line-strong text-left text-xs text-muted"><th scope="col" className="py-1.5 font-medium">Date</th><th scope="col" className="py-1.5 text-right font-medium">Estimated balance</th></tr></thead>
          <tbody className="divide-y divide-line">
            {weekly.map((p) => (<tr key={p.date}><th scope="row" className="py-1.5 text-left font-normal">{p.date}</th><td className="num py-1.5 text-right">{formatMoney(p.balance, currency)}</td></tr>))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
