import { CalendarClock, CheckCircle2 } from "lucide-react";
import { Bar, BALANCE, Ring, rs, Sparkline, Window } from "./parts";

/** Hero product visual: a dashboard window with small contextual panels floating around it. Sample data only. */
export function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[34rem] pb-10 pt-6 lg:mx-0">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/20 via-transparent to-info/10 blur-2xl" />

      <div className="anim-rise" style={{ animationDelay: "120ms" }}>
        <Window title="Budget Buddy · Dashboard">
          <div className="p-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs text-muted">Net worth</p>
                <p className="num text-3xl font-semibold tracking-tight">{rs(247_320)}</p>
              </div>
              <p className="num rounded-full bg-pos/10 px-2.5 py-1 text-xs font-medium text-pos-text">+₹5,120 this week</p>
            </div>
            <Sparkline data={BALANCE} className="mt-3" />
            <ul className="mt-4 divide-y divide-line text-sm">
              {(
                [
                  ["Salary", "Income", "+₹95,000", true],
                  ["Fresh Basket", "Groceries", "-₹1,842", false],
                  ["Move to Savings", "Transfer, not spending", "₹10,000", false],
                ] as const
              ).map(([n, c, a, pos]) => (
                <li key={n} className="flex items-center justify-between py-2.5">
                  <span>
                    <span className="block font-medium">{n}</span>
                    <span className="block text-xs text-muted">{c}</span>
                  </span>
                  <span className={`num ${pos ? "text-pos-text" : ""}`}>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        </Window>
      </div>

      <div className="anim-rise absolute -left-2 top-[9.5rem] hidden w-44 sm:block lg:-left-10" style={{ animationDelay: "420ms" }}>
        <div className="glass bg-surface/90! anim-drift rounded-xl p-3.5 shadow-float">
          <div className="flex items-center gap-3">
            <Ring pct={72} size={52} stroke={6}>
              72%
            </Ring>
            <div>
              <p className="text-xs font-medium">Groceries</p>
              <p className="num text-[11px] text-muted">{rs(3_360)} left</p>
            </div>
          </div>
          <div className="mt-3">
            <Bar pct={91} tone="warn" />
            <p className="mt-1 text-[11px] text-warn-text">Dining is close to its limit</p>
          </div>
        </div>
      </div>

      <div className="anim-rise absolute -right-2 bottom-0 hidden w-56 sm:block lg:-right-6" style={{ animationDelay: "620ms" }}>
        <div className="glass bg-surface/90! anim-drift rounded-xl p-3.5 shadow-float" style={{ animationDelay: "-3s" }}>
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sage text-primary">
              <CalendarClock size={17} aria-hidden />
            </span>
            <div>
              <p className="text-xs font-medium">Rent due in 3 days</p>
              <p className="num text-[11px] text-muted">{rs(22_000)} · 3 Nov</p>
            </div>
          </div>
        </div>
      </div>

      <div className="anim-rise absolute -bottom-1 left-10 hidden sm:block" style={{ animationDelay: "820ms" }}>
        <div className="glass bg-surface/90! flex items-center gap-2 rounded-full py-2 pl-3 pr-4 text-xs shadow-float">
          <CheckCircle2 size={15} className="text-pos" aria-hidden />
          Transaction added
        </div>
      </div>
    </div>
  );
}
