"use client";

import { BarChart3, CalendarDays, LayoutDashboard, PiggyBank, Receipt, Target } from "lucide-react";
import { useId, useRef, useState } from "react";
import { AnalyticsDemo, BudgetsDemo, CalendarDemo, DashboardDemo, GoalsDemo, TransactionsDemo } from "./Demos";
import { Window } from "./parts";

const TABS = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard, title: "See where you stand", body: "Net worth, income and spending for the month, with the balance trend and the budgets that need attention.", Demo: DashboardDemo },
  { id: "transactions", label: "Transactions", Icon: Receipt, title: "Record in seconds", body: "Every transaction is a balanced ledger entry, so account balances and totals always agree.", Demo: TransactionsDemo },
  { id: "budgets", label: "Budgets", Icon: PiggyBank, title: "Know what is left", body: "Limits by category with clear states: on track, close, or over. Unused money can roll into next month.", Demo: BudgetsDemo },
  { id: "goals", label: "Goals", Icon: Target, title: "Save towards something", body: "Put money towards a target and see how long it will take at your current pace.", Demo: GoalsDemo },
  { id: "analytics", label: "Analytics", Icon: BarChart3, title: "Understand the pattern", body: "Compare months and see which categories take the largest share, with a table behind every chart.", Demo: AnalyticsDemo },
  { id: "calendar", label: "Calendar", Icon: CalendarDays, title: "Nothing renews unnoticed", body: "Bills, subscriptions and expected income on one calendar, with what is due this month added up.", Demo: CalendarDemo },
] as const;

/** Interactive, self-contained previews of the product. Everything here is local sample data. */
export function ProductShowcase() {
  const [active, setActive] = useState(0);
  const uid = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tab = TABS[active];

  function onKey(e: React.KeyboardEvent, i: number) {
    const move = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const to = e.key === "Home" ? 0 : TABS.length - 1;
      setActive(to);
      refs.current[to]?.focus();
    } else if (move) {
      e.preventDefault();
      const to = (i + move + TABS.length) % TABS.length;
      setActive(to);
      refs.current[to]?.focus();
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <div role="tablist" aria-label="Product areas" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-col lg:overflow-visible lg:pb-0">
          {TABS.map((t, i) => {
            const on = i === active;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role="tab"
                id={`${uid}-tab-${t.id}`}
                aria-selected={on}
                aria-controls={`${uid}-panel`}
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(i)}
                onKeyDown={(e) => onKey(e, i)}
                className={`flex shrink-0 items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-colors ${on ? "bg-white/12 font-semibold text-white ring-1 ring-white/20 backdrop-blur" : "text-white/65 hover:bg-white/5 hover:text-white"}`}
              >
                <t.Icon size={17} aria-hidden />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="mt-6 hidden max-w-[30ch] lg:block" aria-live="polite">
          <p className="font-display text-2xl text-white">{tab.title}</p>
          <p className="mt-2 text-sm leading-relaxed text-white/65">{tab.body}</p>
        </div>
      </div>
      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab.id}`} className="min-w-0">
        <p className="mb-4 lg:hidden">
          <span className="font-display block text-xl text-white">{tab.title}</span>
          <span className="mt-1 block text-sm text-white/65">{tab.body}</span>
        </p>
        <Window title={`FinTrack · ${tab.label}`} className="min-h-[24rem]">
          <div key={tab.id} className="anim-rise">
            <tab.Demo />
          </div>
        </Window>
      </div>
    </div>
  );
}
