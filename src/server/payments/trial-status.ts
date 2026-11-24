import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/** "Ends in 3 days", "Ends in 5 hours". Pure, so the wording is tested. */
export function trialCountdown(endsAtIso: string, now: Date): { msLeft: number; label: string } {
  const msLeft = new Date(endsAtIso).getTime() - now.getTime();
  if (!Number.isFinite(msLeft) || msLeft <= 0) return { msLeft: 0, label: "Ended" };
  const hours = msLeft / 3_600_000;
  if (hours < 1) return { msLeft, label: "Ends within the hour" };
  if (hours < 24) {
    const h = Math.ceil(hours);
    return { msLeft, label: `Ends in ${h} ${h === 1 ? "hour" : "hours"}` };
  }
  const d = Math.ceil(msLeft / 86_400_000);
  return { msLeft, label: `Ends in ${d} ${d === 1 ? "day" : "days"}` };
}

export interface TrialStatus {
  trialing: boolean;
  endsAt: string | null;
  /** The person already cancelled: nothing will be charged and access stops at the end. */
  cancelled: boolean;
}

const NONE: TrialStatus = { trialing: false, endsAt: null, cancelled: false };

/**
 * Whether the signed-in person is inside the free days of FinTrack One. They are when their latest subscription is
 * running (or cancelled but not yet ended) with a paid-through date still ahead, and no payment has ever been taken.
 * Two small reads through row-level security; cached for the request so the header and the page share them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const loadTrialStatus = cache(async (supabase: SupabaseClient<any, any, any>): Promise<TrialStatus> => {
  const [{ data: subs }, { count }] = await Promise.all([
    supabase.from("billing_subscriptions").select("status,current_period_end,cancel_at_period_end").neq("status", "pending").order("created_at", { ascending: false }).limit(1),
    supabase.from("billing_payments").select("id", { count: "exact", head: true }).in("status", ["captured", "partially_refunded", "refunded"]),
  ]);
  const sub = (subs ?? [])[0] as { status: string; current_period_end: string | null; cancel_at_period_end: boolean } | undefined;
  if (!sub || !sub.current_period_end || (count ?? 0) > 0) return NONE;
  if (!["active", "canceled"].includes(sub.status) || new Date(sub.current_period_end) <= new Date()) return NONE;
  return { trialing: true, endsAt: sub.current_period_end, cancelled: sub.status === "canceled" || sub.cancel_at_period_end };
});
