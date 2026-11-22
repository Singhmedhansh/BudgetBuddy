import type { Tone, Visual } from "@/server/ai/visuals";

/**
 * Finn's charts and cards, drawn as inline SVG and HTML with the app's theme tokens, so they follow light and dark
 * and need no chart library. Each one carries a plain-text summary for screen readers.
 */
const PALETTE = [
  "var(--primary)",
  "var(--info)",
  "var(--warn)",
  "var(--neg)",
  "var(--pos)",
  "var(--mint)",
  "var(--muted)",
];
const TONE_TEXT: Record<Tone, string> = {
  ok: "text-pos-text",
  warn: "text-warn-text",
  bad: "text-neg-text",
  neutral: "text-fg",
};
const TONE_FILL: Record<Tone, string> = {
  ok: "var(--pos)",
  warn: "var(--warn)",
  bad: "var(--neg)",
  neutral: "var(--primary)",
};

function Card({
  title,
  children,
  label,
}: {
  title?: string;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <figure
      aria-label={label}
      className="finn-rise rounded-2xl border border-line bg-surface p-4 shadow-sm"
    >
      {title ? (
        <figcaption className="mb-3 text-sm font-semibold">{title}</figcaption>
      ) : null}
      {children}
    </figure>
  );
}

function Stats({ v }: { v: Extract<Visual, { type: "stats" }> }) {
  return (
    <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      {v.items.map((s, i) => (
        <div
          key={s.label}
          style={{ animationDelay: `${i * 70}ms` }}
          className="finn-rise rounded-2xl border border-line bg-surface px-4 py-3"
        >
          <dt className="text-xs text-muted">{s.label}</dt>
          <dd
            className={`num mt-1 font-display text-xl leading-tight ${TONE_TEXT[s.tone ?? "neutral"]}`}
          >
            {s.value}
          </dd>
          {s.hint ? (
            <p className="mt-0.5 text-xs text-muted">{s.hint}</p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function Donut({ v }: { v: Extract<Visual, { type: "donut" }> }) {
  const total = v.items.reduce((s, i) => s + i.value, 0) || 1;
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <Card
      title={v.title}
      label={`${v.title}. ${v.items.map((i) => `${i.label} ${i.display}`).join(", ")}`}
    >
      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <svg
          viewBox="0 0 110 110"
          className="h-40 w-40 shrink-0 -rotate-90"
          role="img"
          aria-hidden
        >
          <circle
            cx="55"
            cy="55"
            r={R}
            fill="none"
            stroke="var(--surface-sunken)"
            strokeWidth="14"
          />
          {v.items.map((it, i) => {
            const len = (it.value / total) * C;
            const seg = (
              <circle
                key={it.label}
                cx="55"
                cy="55"
                r={R}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth="14"
                strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`}
                strokeDashoffset={-offset}
                className="finn-donut"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <title>{`${it.label}: ${it.display}`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
          {v.center ? (
            <g transform="rotate(90 55 55)">
              <text
                x="55"
                y="53"
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="var(--fg)"
              >
                {v.center.value}
              </text>
              <text
                x="55"
                y="66"
                textAnchor="middle"
                fontSize="7"
                fill="var(--muted)"
              >
                {v.center.label}
              </text>
            </g>
          ) : null}
        </svg>
        <ul className="w-full space-y-2 text-sm">
          {v.items.map((it, i) => (
            <li
              key={it.label}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: PALETTE[i % PALETTE.length] }}
                />
                <span className="truncate">{it.label}</span>
              </span>
              <span className="num shrink-0 text-muted">
                {it.display} · {Math.round((it.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function Bars({ v }: { v: Extract<Visual, { type: "bars" }> }) {
  const max = Math.max(1, ...v.items.map((i) => i.value));
  return (
    <Card
      title={v.title}
      label={`${v.title}. ${v.items.map((i) => `${i.label} ${i.display}`).join(", ")}`}
    >
      <ul className="space-y-3">
        {v.items.map((it, i) => (
          <li key={it.label}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span className="truncate">{it.label}</span>
              <span className="num shrink-0 text-muted">{it.display}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-sunken">
              <div
                className="finn-bar h-full rounded-full"
                style={{
                  width: `${Math.max(2, (it.value / max) * 100)}%`,
                  background: TONE_FILL[it.tone ?? "neutral"],
                  animationDelay: `${i * 70}ms`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Progress({ v }: { v: Extract<Visual, { type: "progress" }> }) {
  return (
    <Card
      title={v.title}
      label={`${v.title}. ${v.items.map((i) => `${i.label} ${i.display}`).join(", ")}`}
    >
      <ul className="space-y-4">
        {v.items.map((it, i) => {
          const pct = Math.max(
            0,
            Math.min(100, (it.value / Math.max(1, it.max)) * 100),
          );
          return (
            <li key={it.label}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{it.label}</span>
                <span className="num shrink-0 text-muted">{it.display}</span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={it.label}
                className="h-3 overflow-hidden rounded-full bg-sunken"
              >
                <div
                  className="finn-bar h-full rounded-full"
                  style={{
                    width: `${Math.max(pct, 2)}%`,
                    background: TONE_FILL[it.tone ?? "neutral"],
                    animationDelay: `${i * 70}ms`,
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted">
                <span>{Math.round(pct)}%</span>
                {it.note ? (
                  <span className={TONE_TEXT[it.tone ?? "neutral"]}>
                    {it.note}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Columns({ v }: { v: Extract<Visual, { type: "columns" }> }) {
  const max = Math.max(1, ...v.groups.flatMap((g) => g.values));
  const W = 560;
  const H = 190;
  const pad = { l: 6, r: 6, t: 14, b: 26 };
  const slot = (W - pad.l - pad.r) / v.groups.length;
  const bar = Math.min(26, slot / (v.series.length + 0.6));
  const y = (val: number) => pad.t + (H - pad.t - pad.b) * (1 - val / max);
  const colors = ["var(--pos)", "var(--fg)"];
  return (
    <Card
      title={v.title}
      label={`${v.title}. ${v.groups.map((g) => `${g.label}: ${v.series.map((s, i) => `${s} ${g.display[i]}`).join(", ")}`).join(". ")}`}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-hidden
      >
        <line
          x1={pad.l}
          x2={W - pad.r}
          y1={H - pad.b}
          y2={H - pad.b}
          stroke="var(--line-strong)"
        />
        {v.groups.map((g, gi) => {
          const cx = pad.l + slot * gi + slot / 2;
          const start =
            cx - (bar * v.series.length + (v.series.length - 1) * 2) / 2;
          return (
            <g key={g.label}>
              {g.values.map((val, si) => (
                <rect
                  key={si}
                  x={start + si * (bar + 2)}
                  y={y(val)}
                  width={bar}
                  height={Math.max(0, H - pad.b - y(val))}
                  rx={3}
                  fill={colors[si % colors.length]}
                  opacity={si === 1 ? 0.75 : 1}
                  className="finn-col"
                  style={{ animationDelay: `${gi * 60}ms` }}
                >
                  <title>{`${g.label}, ${v.series[si]}: ${g.display[si]}`}</title>
                </rect>
              ))}
              <text
                x={cx}
                y={H - 8}
                textAnchor="middle"
                fontSize="11"
                fill="var(--muted)"
              >
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 flex flex-wrap gap-5 text-xs text-muted">
        {v.series.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-sm"
              style={{
                background: colors[i % colors.length],
                opacity: i === 1 ? 0.75 : 1,
              }}
            />
            {s}
          </span>
        ))}
      </p>
    </Card>
  );
}

function Line({ v }: { v: Extract<Visual, { type: "line" }> }) {
  const W = 560;
  const H = 210;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const top = v.yTicks[v.yTicks.length - 1]?.value || 1;
  const steps = Math.max(1, v.xLabels.length - 1);
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / steps;
  const y = (val: number) =>
    pad.t + (H - pad.t - pad.b) * (1 - Math.min(val, top) / top);
  const colors = ["var(--primary)", "var(--muted)"];
  const every = Math.ceil(v.xLabels.length / 8);
  return (
    <Card
      title={v.title}
      label={`${v.title}. ${v.series.map((s) => `${s.name} ends at ${s.end}`).join(". ")}`}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-hidden
      >
        <defs>
          <linearGradient id="finn-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {v.yTicks.map((t) => (
          <g key={t.value}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(t.value)}
              y2={y(t.value)}
              stroke="var(--line)"
            />
            <text
              x={pad.l - 6}
              y={y(t.value) + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted)"
            >
              {t.label}
            </text>
          </g>
        ))}
        {v.xLabels.map((l, i) =>
          i % every === 0 || i === v.xLabels.length - 1 ? (
            <text
              key={l + i}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="var(--muted)"
            >
              {l}
            </text>
          ) : null,
        )}
        {v.series.map((s, si) => {
          const d = s.points
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`,
            )
            .join(" ");
          return (
            <g key={s.name}>
              {si === 0 ? (
                <path
                  d={`${d} L${x(s.points.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`}
                  fill="url(#finn-area)"
                />
              ) : null}
              <path
                d={d}
                fill="none"
                stroke={colors[si % colors.length]}
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "5 5" : undefined}
                pathLength={s.dashed ? undefined : 1}
                className={s.dashed ? "" : "finn-draw"}
              />
              {s.points.map((p, i) =>
                i === s.points.length - 1 ? (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(p)}
                    r="3.6"
                    fill={colors[si % colors.length]}
                  />
                ) : null,
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        {v.series.map((s, i) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-4 rounded"
              style={{ background: colors[i % colors.length] }}
            />
            {s.name}: <span className="num text-fg">{s.end}</span>
          </span>
        ))}
      </p>
    </Card>
  );
}

function Timeline({ v }: { v: Extract<Visual, { type: "timeline" }> }) {
  return (
    <Card
      title={v.title}
      label={`${v.title}. ${v.items.map((i) => `${i.label} ${i.display} on ${i.date}`).join(", ")}`}
    >
      <ol className="space-y-2">
        {v.items.map((it, i) => {
          const d = new Date(`${it.date}T00:00:00`);
          return (
            <li
              key={`${it.label}${it.date}`}
              style={{ animationDelay: `${i * 60}ms` }}
              className="finn-rise flex items-center gap-3 rounded-xl border border-line px-3 py-2.5"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-sage text-center leading-none">
                <span>
                  <span className="block text-sm font-semibold">
                    {Number.isNaN(d.getTime()) ? "" : d.getDate()}
                  </span>
                  <span className="block text-[10px] uppercase text-muted">
                    {Number.isNaN(d.getTime())
                      ? ""
                      : d.toLocaleDateString("en-IN", { month: "short" })}
                  </span>
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {it.label}
                </span>
                <span className={`text-xs ${TONE_TEXT[it.tone ?? "neutral"]}`}>
                  {it.state}
                </span>
              </span>
              <span className="num shrink-0 text-sm font-medium">
                {it.display}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export function FinnVisuals({ visuals }: { visuals: Visual[] }) {
  if (!visuals.length) return null;
  return (
    <div className="mt-3 space-y-3">
      {visuals.map((v, i) => {
        switch (v.type) {
          case "stats":
            return <Stats key={i} v={v} />;
          case "donut":
            return <Donut key={i} v={v} />;
          case "bars":
            return <Bars key={i} v={v} />;
          case "progress":
            return <Progress key={i} v={v} />;
          case "columns":
            return <Columns key={i} v={v} />;
          case "line":
            return <Line key={i} v={v} />;
          case "timeline":
            return <Timeline key={i} v={v} />;
        }
      })}
    </div>
  );
}
