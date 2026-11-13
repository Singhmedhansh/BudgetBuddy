import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, formatDay, Money, PageHeader } from "@/components/app/ui";
import { daysInMonth } from "@/domain/recurrence";
import { requireSpace } from "@/server/context";
import { calendarEvents, todayFor, type CalendarEvent } from "@/server/planning";

export const metadata: Metadata = { title: "Calendar" };

const KIND_LABEL = { bill: "Bill", subscription: "Subscription", income: "Income", goal: "Goal", debt: "Debt payment" } as const;
const NATURE = {
  actual: { label: "Done", tone: "text-pos-text" },
  scheduled: { label: "Scheduled", tone: "text-muted" },
  estimate: { label: "Estimate from your terms", tone: "text-info-text" },
} as const;

function monthOf(param: string | undefined, today: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(param ?? "");
  const [y, mo] = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? [Number(m[1]), Number(m[2])] : today.split("-").slice(0, 2).map(Number);
  return { y, m: mo };
}
const shift = (y: number, m: number, by: number) => {
  const t = y * 12 + (m - 1) + by;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
};
const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ctx = await requireSpace();
  const today = todayFor(ctx);
  const { y, m } = monthOf((await searchParams).m, today);
  const from = `${key(y, m)}-01`;
  const to = `${key(y, m)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  const events = await calendarEvents(ctx, from, to);
  const prev = shift(y, m, -1);
  const next = shift(y, m, 1);
  const label = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1)));

  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  return (
    <>
      <PageHeader title="Calendar" description="Bills, subscriptions, expected income, goal deadlines and debt payments in one place. Scheduled items are plans; Done means it has been recorded." help={{ slug: "financial-calendar", label: "reading the calendar" }} />
      <div className="mb-6 flex items-center justify-between">
        <Link href={`/app/calendar?m=${key(prev.y, prev.m)}`} className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm hover:border-primary" aria-label="Previous month">
          Previous
        </Link>
        <h2 className="font-semibold">{label}</h2>
        <Link href={`/app/calendar?m=${key(next.y, next.m)}`} className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm hover:border-primary" aria-label="Next month">
          Next
        </Link>
      </div>

      {events.length === 0 ? (
        <EmptyState title="Nothing scheduled this month" body="Add bills, subscriptions, expected income or goal deadlines and they will appear here." action={{ href: "/app/bills/new", label: "Add a bill" }} />
      ) : (
        <ol className="divide-y divide-line border-y border-line">
          {[...byDay.entries()].map(([date, list]) => (
            <li key={date} className={`grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[9rem_1fr] ${date === today ? "bg-sage/30" : ""}`}>
              <p className="text-sm font-medium">
                {formatDay(date)}
                {date === today ? <span className="ml-2 text-xs font-normal text-muted">Today</span> : null}
              </p>
              <ul className="space-y-2">
                {list.map((e, i) => {
                  const n = NATURE[e.nature];
                  return (
                    <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <Link href={e.href} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                        {e.title}
                      </Link>
                      <span className="text-xs text-muted">
                        {KIND_LABEL[e.kind]}
                        {e.amount !== null ? <> · <Money minor={e.amount} currency={ctx.space.currency} /></> : null}
                        {" · "}
                        <span className={n.tone}>{e.state === "overdue" && e.nature !== "actual" ? "Overdue" : n.label}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
