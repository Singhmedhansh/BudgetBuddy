import Link from "next/link";
import { AI_ALLOWANCE, planById, type PlanId } from "@/config/plans";
import { TRIAL_DAYS } from "@/config/plans";
import type { Quota } from "@/server/ai/chats";

/** A slim "questions left today" meter above the composer, like the usage hints in ChatGPT and Claude. */
export function UsageMeter({ quota, used }: { quota: Quota; used: number }) {
  const left = Math.max(0, quota.questionsPerDay - used);
  const pct = Math.min(100, (used / quota.questionsPerDay) * 100);
  const monthPct = Math.min(
    100,
    (quota.tokensMonth / quota.tokensPerMonth) * 100,
  );
  const low = left <= Math.max(1, Math.floor(quota.questionsPerDay * 0.2));
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted"
      aria-label="Your Finn allowance"
    >
      <span className="inline-flex items-center gap-2">
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={quota.questionsPerDay}
          aria-valuenow={Math.min(used, quota.questionsPerDay)}
          aria-label="Questions used today"
          className="h-1.5 w-20 overflow-hidden rounded-full bg-sunken"
        >
          <span
            className="block h-full rounded-full"
            style={{
              width: `${Math.max(pct, 3)}%`,
              background: low ? "var(--warn)" : "var(--primary)",
            }}
          />
        </span>
        <span className={low ? "text-warn-text" : ""}>
          {left} of {quota.questionsPerDay} questions left today
        </span>
      </span>
      {monthPct >= 60 ? (
        <span>{Math.round(monthPct)}% of this month&apos;s allowance used</span>
      ) : null}
      {quota.plan === "free" && low ? (
        <Link
          href="/app/checkout"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Get {AI_ALLOWANCE.pro.questionsPerDay} a day
        </Link>
      ) : null}
    </div>
  );
}

/** Shown in place of the composer when the plan's allowance is used up. Explains the reset and the way to more. */
export function LimitCard({
  plan,
  kind,
  perDay,
}: {
  plan: PlanId;
  kind: "day" | "month";
  perDay: number;
}) {
  const one = planById("pro");
  return (
    <div
      role="status"
      className="mt-3 rounded-2xl border border-line bg-surface p-5 shadow-sm"
    >
      <p className="font-display text-lg">
        {kind === "day"
          ? `You have used today's ${perDay} questions.`
          : "You have used this month's Finn allowance."}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {kind === "day" ? "They reset at midnight." : "It resets on the 1st."}{" "}
        {plan === "free"
          ? `${one.name} gives you ${AI_ALLOWANCE.pro.questionsPerDay} questions a day, with charts, and the first ${TRIAL_DAYS} days are free.`
          : "Your chats are saved, so you can read them any time."}
      </p>
      {plan === "free" ? (
        <Link
          href="/app/checkout"
          className="mt-3 inline-block rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-fg transition-all hover:-translate-y-px hover:bg-primary-hover"
        >
          Start your {TRIAL_DAYS}-day free trial
        </Link>
      ) : null}
    </div>
  );
}
