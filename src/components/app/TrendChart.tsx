import { formatMoney } from "@/domain/money";

interface Point {
  label: string;
  income: number;
  expenses: number;
}

/**
 * Paired bars per month, drawn as inline SVG with theme tokens (so it follows
 * light and dark). The chart has a text summary and an equivalent data table, so
 * the numbers are available without relying on sight or on hover.
 */
export function TrendChart({ data, currency }: { data: Point[]; currency: string }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expenses]));
  const W = 560;
  const H = 180;
  const pad = { l: 8, r: 8, t: 8, b: 26 };
  const slot = (W - pad.l - pad.r) / data.length;
  const bar = Math.min(26, slot / 2.6);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const summary = data.map((d) => `${d.label}: income ${formatMoney(d.income, currency)}, spending ${formatMoney(d.expenses, currency)}`).join(". ");

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Income and spending by month. ${summary}`} className="h-auto w-full">
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line-strong)" />
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={d.label}>
              <rect x={cx - bar - 1} y={y(d.income)} width={bar} height={Math.max(0, H - pad.b - y(d.income))} rx={2} fill="var(--pos)" />
              <rect x={cx + 1} y={y(d.expenses)} width={bar} height={Math.max(0, H - pad.b - y(d.expenses))} rx={2} fill="var(--fg)" opacity={0.75} />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{d.label}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex gap-5 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-pos" aria-hidden />Income</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-fg opacity-75" aria-hidden />Spending</span>
      </figcaption>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-primary">Show as a table</summary>
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Income and spending by month</caption>
          <thead><tr className="border-b border-line-strong text-left text-xs text-muted"><th scope="col" className="py-1.5 font-medium">Month</th><th scope="col" className="py-1.5 text-right font-medium">Income</th><th scope="col" className="py-1.5 text-right font-medium">Spending</th></tr></thead>
          <tbody className="divide-y divide-line">
            {data.map((d) => (
              <tr key={d.label}><th scope="row" className="py-1.5 text-left font-normal">{d.label}</th><td className="num py-1.5 text-right">{formatMoney(d.income, currency)}</td><td className="num py-1.5 text-right">{formatMoney(d.expenses, currency)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
