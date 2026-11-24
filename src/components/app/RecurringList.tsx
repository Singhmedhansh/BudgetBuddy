import { Check, Plus, ReceiptText, Repeat, Wallet } from "lucide-react";
import Link from "next/link";
import { settleItemAction, setItemStatusAction } from "@/app/app/planning-actions";
import { STARTERS, starterHref } from "@/components/app/recurring-starters";
import { formatDay, Money, Notice, PageHeader } from "@/components/app/ui";

const KIND_ICON = { income: Wallet, bill: ReceiptText, subscription: Repeat } as const;

/** What adding the first item gets you, in plain words. Only things the app does today. */
const WHY = {
  income: ["See what is coming in this month, next to what is going out.", "Mark it received in one tap, which records it in the right account.", "Forecasts and Finn plan around the income you expect."],
  bill: ["See what falls due this month before it does.", "Mark it paid in one tap, which records the expense.", "Overdue bills stand out, so nothing slips."],
  subscription: ["See what your services cost each month and each year.", "Know when each one renews, before it does.", "Spot the ones you no longer use."],
} as const;
import type { RecurringView } from "@/server/planning";

const FREQ_LABEL = { once: "One time", weekly: "Weekly", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" } as const;
const STATE_LABEL = { paid: "Paid", overdue: "Overdue", due_soon: "Due soon", upcoming: "Upcoming" } as const;
const STATE_TONE = { paid: "text-pos-text", overdue: "text-neg-text", due_soon: "text-warn-text", upcoming: "text-muted" } as const;

const COPY = {
  bill: { title: "Bills", desc: "Payments that come due, like rent, electricity or loan instalments. Marking one paid records the expense.", add: "Add bill", done: "Mark paid", doneNote: "Bill marked paid and recorded as an expense.", empty: { t: "No bills yet", b: "Add rent, utilities, insurance or anything that falls due, and see what is coming up." }, help: { slug: "bills-and-subscriptions", label: "bills and subscriptions" } },
  subscription: { title: "Subscriptions", desc: "Recurring services like streaming and software. FinTrack tracks renewals; it cannot cancel anything with the provider.", add: "Add subscription", done: "Mark paid", doneNote: "Renewal marked paid and recorded as an expense.", empty: { t: "No subscriptions yet", b: "Add the services you pay for to see what they cost each month and year." }, help: { slug: "bills-and-subscriptions", label: "bills and subscriptions" } },
  income: { title: "Income", desc: "Money you expect to receive. It changes no balance until you mark it received, which records the income.", add: "Add expected income", done: "Mark received", doneNote: "Income marked received and added to the account.", empty: { t: "No expected income yet", b: "Add your salary or other regular income to plan around it." }, help: { slug: "expected-income", label: "expected income" } },
} as const;

export function RecurringList({
  kind,
  items,
  currency,
  flags,
}: {
  kind: "bill" | "subscription" | "income";
  items: RecurringView[];
  currency: string;
  flags: { added?: string; settled?: string; error?: string };
}) {
  const c = COPY[kind];
  const KindIcon = KIND_ICON[kind];
  const active = items.filter((i) => i.status === "active");
  const monthly = active.reduce((s, i) => s + i.monthly, 0);
  const yearly = active.reduce((s, i) => s + i.yearly, 0);
  const base = kind === "bill" ? "/app/bills" : kind === "subscription" ? "/app/subscriptions" : "/app/income";
  const unconfigured = (i: RecurringView) => !i.accountName || !i.categoryName;

  return (
    <>
      <PageHeader title={c.title} description={c.desc} action={{ href: `${base}/new`, label: c.add }} help={c.help} />
      {flags.added ? <Notice kind="success">Saved.</Notice> : null}
      {flags.settled ? <Notice kind="success">{c.doneNote}</Notice> : null}
      {flags.error ? <Notice kind="error">{flags.error}</Notice> : null}

      {items.length === 0 ? (
        <section aria-labelledby="empty-title" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr]">
            <div>
              <span aria-hidden className="grid h-12 w-12 place-items-center rounded-xl bg-sage text-primary">
                <KindIcon size={22} />
              </span>
              <h2 id="empty-title" className="font-display mt-5 text-2xl">
                {c.empty.t}
              </h2>
              <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-muted">{c.empty.b}</p>
              <ul className="mt-6 space-y-3 text-sm">
                {WHY[kind].map((w) => (
                  <li key={w} className="flex gap-3">
                    <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sage text-primary">
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <span className="leading-relaxed">{w}</span>
                  </li>
                ))}
              </ul>
              <Link href={`${base}/new`} className="mt-7 inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-fg shadow-sm transition-all hover:-translate-y-px hover:bg-primary-hover hover:shadow-card">
                {c.add}
              </Link>
            </div>
            <div>
              <p className="text-sm font-semibold">Start with one of these</p>
              <p className="mt-1 text-sm text-muted">Opens the form with the details filled in. Add the amount and save.</p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {STARTERS[kind].map((s) => (
                  <li key={s.name}>
                    <Link href={starterHref(base, s)} className="group flex h-full items-start justify-between gap-3 rounded-xl border border-line bg-bg p-4 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-card">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{s.name}</span>
                        <span className="mt-0.5 block text-xs text-muted">{s.note}</span>
                        <span className="mt-3 inline-block rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-muted">{FREQ_LABEL[s.frequency ?? "monthly"]}</span>
                      </span>
                      <Plus size={16} aria-hidden className="mt-0.5 shrink-0 text-muted transition-colors group-hover:text-primary" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : (
        <>
          {kind !== "bill" ? (
            <p className="mb-6 text-sm text-muted">
              Active {kind === "income" ? "income" : "cost"}: <Money minor={monthly} currency={currency} className="font-medium text-fg" /> a month, about{" "}
              <Money minor={yearly} currency={currency} className="font-medium text-fg" /> a year. Weekly and yearly items are averaged by month.
            </p>
          ) : null}
          <ul className="divide-y divide-line border-y border-line">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
                <div className="min-w-0">
                  <p className={`truncate text-sm font-medium ${i.status !== "active" ? "text-muted" : ""}`}>
                    {i.name}
                    {i.status !== "active" ? <span className="ml-2 text-xs font-normal">{i.status === "paused" ? "Paused" : "Cancelled"}</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    <Money minor={i.amount} currency={currency} /> · {FREQ_LABEL[i.frequency]}
                    {i.accountName ? ` · ${i.accountName}` : ""}
                    {kind === "subscription" ? (i.autoRenews ? " · renews automatically" : " · does not auto-renew") : ""}
                  </p>
                  {i.notes ? <p className="mt-0.5 text-xs text-muted">{i.notes}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  {i.due ? (
                    <p className={`text-sm ${STATE_TONE[i.due.state]}`}>
                      {STATE_LABEL[i.due.state]} · {formatDay(i.due.date)}
                    </p>
                  ) : i.status === "active" ? (
                    <p className="text-sm text-muted">Finished</p>
                  ) : null}
                  {i.due && i.status === "active" ? (
                    unconfigured(i) ? (
                      <span className="text-xs text-muted">Add an account and category to mark it done</span>
                    ) : (
                      <form action={settleItemAction}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="due" value={i.due.date} />
                        <input type="hidden" name="kind" value={kind} />
                        <button type="submit" className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium hover:border-primary" aria-label={`${c.done}: ${i.name}`}>
                          {c.done}
                        </button>
                      </form>
                    )
                  ) : null}
                  {i.status !== "cancelled" ? (
                    <form action={setItemStatusAction} className="flex gap-3 text-xs">
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="kind" value={kind} />
                      <button type="submit" name="status" value={i.status === "active" ? "paused" : "active"} className="text-muted underline hover:text-fg">
                        {i.status === "active" ? "Pause" : "Resume"}
                      </button>
                      <button type="submit" name="status" value="cancelled" className="text-muted underline hover:text-fg">
                        {kind === "subscription" ? "Mark cancelled" : "Stop"}
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
