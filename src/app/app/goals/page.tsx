import type { Metadata } from "next";
import { addContributionAction, setGoalStatusAction } from "@/app/app/planning-actions";
import { EmptyState, formatDay, Money, Notice, PageHeader } from "@/components/app/ui";
import { requireSpace } from "@/server/context";
import { listGoals } from "@/server/planning";

export const metadata: Metadata = { title: "Savings goals" };

const HEALTH = {
  complete: { label: "Reached", tone: "text-pos-text" },
  on_track: { label: "On track at your recent pace", tone: "text-pos-text" },
  behind: { label: "Behind your deadline at your recent pace", tone: "text-warn-text" },
  no_deadline: { label: "No deadline set", tone: "text-muted" },
} as const;

export default async function GoalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const goals = await listGoals(ctx);
  const c = ctx.space.currency;

  return (
    <>
      <PageHeader
        title="Savings goals"
        description="Track what you are putting aside. Amounts you add are tracked here only: they do not move money or change any account balance."
        action={{ href: "/app/goals/new", label: "Create goal" }}
        help={{ slug: "savings-goals", label: "how savings goals work" }}
      />
      {sp.added ? <Notice kind="success">Goal created.</Notice> : null}
      {sp.saved ? <Notice kind="success">Saved.</Notice> : null}
      {sp.error ? <Notice kind="error">{sp.error}</Notice> : null}

      {goals.length === 0 ? (
        <EmptyState title="No goals yet" body="Name something you are saving for, set a target and, if you like, a deadline." action={{ href: "/app/goals/new", label: "Create a goal" }} />
      ) : (
        <ul className="space-y-10">
          {goals.map((g) => {
            const pct = Math.round(g.ratio * 100);
            const h = HEALTH[g.health];
            return (
              <li key={g.id} className={g.status === "paused" ? "opacity-70" : ""}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">
                    {g.name}
                    {g.status !== "active" ? <span className="ml-2 text-xs font-normal text-muted">{g.status === "paused" ? "Paused" : "Completed"}</span> : null}
                  </h2>
                  <p className="text-sm text-muted">
                    <Money minor={g.saved} currency={c} /> of <Money minor={g.target} currency={c} />
                  </p>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${g.name} progress`}>
                  <div className="h-full bg-pos" style={{ width: `${pct}%` }} />
                </div>
                <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-3"><dt className="text-muted">Remaining</dt><dd><Money minor={g.remaining} currency={c} /></dd></div>
                  {g.deadline ? <div className="flex justify-between gap-3"><dt className="text-muted">Deadline</dt><dd>{formatDay(g.deadline)}</dd></div> : null}
                  {g.monthlyTarget !== null && g.monthlyTarget > 0 ? <div className="flex justify-between gap-3"><dt className="text-muted">To set aside each month</dt><dd><Money minor={g.monthlyTarget} currency={c} /></dd></div> : null}
                  {g.estimate && g.health !== "complete" ? <div className="flex justify-between gap-3"><dt className="text-muted">Estimated finish</dt><dd>{formatDay(g.estimate)} <span className="text-xs text-muted">(estimate)</span></dd></div> : null}
                </dl>
                <p className={`mt-2 text-sm ${h.tone}`}>{h.label}</p>

                {g.status === "active" ? (
                  <form action={addContributionAction} className="mt-4 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="goalId" value={g.id} />
                    <div>
                      <label htmlFor={`amt-${g.id}`} className="mb-1 block text-xs text-muted">Amount ({c})</label>
                      <input id={`amt-${g.id}`} name="amount" inputMode="decimal" autoComplete="off" className="w-32 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label htmlFor={`note-${g.id}`} className="mb-1 block text-xs text-muted">Note (optional)</label>
                      <input id={`note-${g.id}`} name="note" maxLength={200} className="w-44 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" />
                    </div>
                    <button type="submit" name="direction" value="add" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:bg-primary-hover">Add to goal</button>
                    <button type="submit" name="direction" value="withdraw" className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium hover:border-primary">Take out</button>
                  </form>
                ) : null}

                {g.recent.length > 0 ? (
                  <ul className="mt-4 space-y-1 text-xs text-muted">
                    {g.recent.map((r) => (
                      <li key={r.id}>
                        {formatDay(r.date)} · <Money minor={r.amount} currency={c} signed />{r.note ? ` · ${r.note}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <form action={setGoalStatusAction} className="mt-3 flex gap-4 text-xs">
                  <input type="hidden" name="goalId" value={g.id} />
                  {g.status === "active" ? <button type="submit" name="status" value="paused" className="text-muted underline hover:text-fg">Pause</button> : <button type="submit" name="status" value="active" className="text-muted underline hover:text-fg">Resume</button>}
                  {g.status !== "completed" ? <button type="submit" name="status" value="completed" className="text-muted underline hover:text-fg">Mark completed</button> : null}
                  <button type="submit" name="status" value="archived" className="text-muted underline hover:text-fg">Archive</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
