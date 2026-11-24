import { formatMoney } from "@/domain/money";

/** Sample-data helpers shared by the landing page previews. All figures are examples, never a real user's. */
export const rs = (rupees: number) => formatMoney(Math.round(rupees * 100), "INR", "en-IN").replace(/\.00$/, "");

export function Window({ title, children, className = "", badge = "Sample data" }: { title: string; children: React.ReactNode; className?: string; badge?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-line-strong bg-surface text-fg shadow-float ${className}`}>
      <div className="flex items-center gap-3 border-b border-line bg-sunken px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <i className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          <i className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="text-xs text-muted">{title}</span>
        <span className="ml-auto rounded-full bg-sage px-2 py-0.5 text-[10px] font-medium text-fg">{badge}</span>
      </div>
      {children}
    </div>
  );
}

export function Bar({ pct, tone = "ok", delay = 0 }: { pct: number; tone?: "ok" | "warn" | "over"; delay?: number }) {
  const color = tone === "over" ? "bg-neg" : tone === "warn" ? "bg-warn" : "bg-primary";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-sunken" role="presentation">
      <div className={`h-full rounded-full ${color} transition-[width] duration-700 ease-out`} style={{ width: `${Math.min(100, pct)}%`, transitionDelay: `${delay}ms` }} />
    </div>
  );
}

export function Sparkline({ data, w = 320, h = 90, className = "" }: { data: number[]; w?: number; h?: number; className?: string }) {
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const x = (i: number) => (w * i) / (data.length - 1);
  const y = (v: number) => 6 + (h - 12) * (1 - (v - lo) / (hi - lo || 1));
  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-auto w-full ${className}`} aria-hidden preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark)" />
      <path d={line} pathLength={1} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="anim-draw" style={{ ["--len" as string]: 1 }} />
    </svg>
  );
}

export function Ring({ pct, size = 64, stroke = 7, children }: { pct: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--primary)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, pct / 100))} className="transition-[stroke-dashoffset] duration-700 ease-out" />
      </svg>
      <span className="num absolute text-xs font-semibold">{children}</span>
    </span>
  );
}

export const BALANCE = [182, 184, 183, 190, 188, 186, 194, 201, 199, 198, 204, 209, 207, 205, 212, 218, 216, 214, 219, 224, 222, 220, 226, 231, 229, 233, 238, 236, 241, 247].map((n) => n * 1000);
