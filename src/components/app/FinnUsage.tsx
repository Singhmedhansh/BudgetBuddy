import Link from "next/link";
import { AI_ALLOWANCE, planById, type PlanId } from "@/config/plans";
import { TRIAL_DAYS } from "@/config/plans";
import type { Quota } from "@/server/ai/chats";

/** "3:40 pm" in the person's own clock, for when the next message frees up. */
export function freeTime(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
  return sameDay
    ? time
    : `${d.toLocaleDateString("en-IN", { weekday: "short" })} ${time}`;
}

/**
 * A slim allowance meter above the composer, like the usage hints in ChatGPT and Claude. With the rolling window
 * (migration 19) it counts messages in the window; before that, questions today.
 */
export function UsageMeter({
  quota,
  used,
  windowUsed = null,
}: {
  quota: Quota;
  used: number;
  windowUsed?: number | null;
}) {
  const w = quota.window && windowUsed !== null ? quota.window : null;
  const cap = w ? w.per : quota.questionsPerDay;
  const count = w ? windowUsed! : used;
  const left = Math.max(0, cap - count);
  const pct = Math.min(100, (count / cap) * 100);
  const monthPct = Math.min(
    100,
    (quota.tokensMonth / quota.tokensPerMonth) * 100,
  );
  const low = left <= Math.max(1, Math.floor(cap * 0.2));
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted"
      aria-label="Your Finn allowance"
    >
      <span className="inline-flex items-center gap-2">
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-valuenow={Math.min(count, cap)}
          aria-label={
            w
              ? `Messages used in the last ${w.hours} hours`
              : "Questions used today"
          }
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
          {w
            ? `${left} of ${w.per} messages left${left === 0 && w.freesAt ? `, more at ${freeTime(w.freesAt)}` : ` in this ${w.hours}-hour window`}`
            : `${left} of ${quota.questionsPerDay} questions left today`}
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
          Get {AI_ALLOWANCE.pro.questionsPerWindow} every{" "}
          {AI_ALLOWANCE.pro.windowHours} hours
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
  perWindow,
  windowHours,
  retryAt = null,
}: {
  plan: PlanId;
  kind: "window" | "day" | "month";
  perDay: number;
  perWindow?: number;
  windowHours?: number;
  retryAt?: string | null;
}) {
  const one = planById("pro");
  return (
    <div
      role="status"
      className="mt-3 rounded-2xl border border-line bg-surface p-5 shadow-sm"
    >
      <p className="font-display text-lg">
        {kind === "window"
          ? `You have used your ${perWindow ?? ""} messages for the last ${windowHours ?? 5} hours.`.replace(
              "  ",
              " ",
            )
          : kind === "day"
            ? `You have used today's ${perDay} questions.`
            : "You have used this month's Finn allowance."}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {kind === "window"
          ? retryAt
            ? `The next one frees up at ${freeTime(retryAt)}.`
            : "They free up over the next few hours."
          : kind === "day"
            ? "They reset at midnight."
            : "It resets on the 1st."}{" "}
        You can still record what you spent, like &ldquo;400 on food&rdquo;.{" "}
        {plan === "free"
          ? `${one.name} gives you ${AI_ALLOWANCE.pro.questionsPerWindow} messages every ${AI_ALLOWANCE.pro.windowHours} hours, with charts, and the first ${TRIAL_DAYS} days are free.`
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
