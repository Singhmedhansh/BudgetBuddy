import { settleItemAction, setItemStatusAction } from "@/app/app/planning-actions";
import { EmptyState, formatDay, Money, Notice, PageHeader } from "@/components/app/ui";
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
        <EmptyState title={c.empty.t} body={c.empty.b} action={{ href: `${base}/new`, label: c.add }} />
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
