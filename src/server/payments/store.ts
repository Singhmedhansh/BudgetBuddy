import type { SupabaseClient } from "@supabase/supabase-js";
import { BillingError, type ApplyOutcome, type BillingEvent, type Interval } from "./types";

/** The service-role client from src/server/admin.ts. Only this module and the webhook/checkout routes write billing rows. */
export type Admin = SupabaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** At most this many checkouts may be started per person per hour, across providers. */
export const CHECKOUTS_PER_HOUR = 5;
/** A checkout that was never completed stops blocking a new one after this long. */
export const PENDING_TTL_MS = 60 * 60_000;

/** Records one provider event atomically and idempotently (see migration 12). Throws on a database failure so the provider retries. */
export async function applyBillingEvent(admin: Admin, ev: BillingEvent): Promise<ApplyOutcome> {
  const { data, error } = await admin.rpc("billing_apply_event", {
    p_provider: ev.provider,
    p_event_id: ev.eventId,
    p_event_type: ev.eventType,
    p_event_at: ev.eventAt.toISOString(),
    p_user: ev.userId,
    p_subscription: ev.subscription,
    p_payment: ev.payment,
  });
  if (error) throw new BillingError("provider_error", 500);
  // A code is used up only when the subscription that used it has really started. Idempotent and best-effort: it must never
  // fail a payment event (and does nothing until migration 13 exists).
  if (ev.subscription && (ev.subscription.status === "active" || ev.subscription.status === "past_due" || ev.subscription.status === "canceled")) {
    await Promise.resolve(admin.rpc("billing_redeem_for_subscription", { p_provider: ev.provider, p_sub: ev.subscription.provider_subscription_id })).catch(() => undefined);
  }
  return data as ApplyOutcome;
}

export interface SubscriptionRow {
  id: string;
  /** Null once the sign-in identity has been removed: the record is kept, the person is gone. */
  user_id: string | null;
  provider: "razorpay" | "paypal";
  provider_subscription_id: string;
  interval: Interval;
  amount_minor: number;
  currency: string;
  status: "pending" | "active" | "past_due" | "canceled" | "expired";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  /** Set when migration 13 is applied. The trial this checkout promised, the provider plan it used, and the code it used. */
  trial_days?: number | null;
  plan_ref?: string | null;
  coupon_id?: string | null;
}

export async function findSubscription(admin: Admin, provider: string, providerSubscriptionId: string): Promise<SubscriptionRow | null> {
  const { data } = await admin.from("billing_subscriptions").select("*").eq("provider", provider).eq("provider_subscription_id", providerSubscriptionId).maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}

/** A person with a paid, still-running subscription cannot start another one. */
export async function hasLiveSubscription(admin: Admin, userId: string, now = new Date()): Promise<boolean> {
  const { data } = await admin.from("billing_subscriptions").select("status,current_period_end").eq("user_id", userId).in("status", ["active", "past_due", "canceled"]);
  return (data ?? []).some((s: { status: string; current_period_end: string | null }) => s.status !== "canceled" ? true : s.current_period_end !== null && new Date(s.current_period_end) > now);
}

/**
 * One free trial per person. A person who has ever had a subscription start (started_at is set the moment a mandate or
 * payment is confirmed) pays from day one if they come back; an abandoned checkout does not count.
 */
export async function trialEligible(admin: Admin, userId: string): Promise<boolean> {
  const { count } = await admin.from("billing_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId).not("started_at", "is", null);
  return (count ?? 0) === 0;
}

export async function checkoutsInLastHour(admin: Admin, userId: string, now = new Date()): Promise<number> {
  const { count } = await admin.from("billing_audit").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("action", "checkout_created").gte("created_at", new Date(now.getTime() - 3_600_000).toISOString());
  return count ?? 0;
}

export async function audit(admin: Admin, row: { userId: string | null; provider: string; actor: string; action: string; detail?: Record<string, unknown> }) {
  await admin.from("billing_audit").insert({ user_id: row.userId, provider: row.provider, actor: row.actor, action: row.action, detail: row.detail ?? {} });
}

/**
 * Starts a checkout on record. The expected amount and currency are written here, by the server, before the customer
 * pays, and every later payment is compared with them. One open attempt per person, provider and interval: an
 * existing fresh one is returned instead of creating a second, and a stale one is expired first.
 */
export async function reservePending(
  admin: Admin,
  args: { userId: string; provider: "razorpay" | "paypal"; interval: Interval },
  now = new Date(),
): Promise<{ existing: SubscriptionRow | null }> {
  if ((await checkoutsInLastHour(admin, args.userId, now)) >= CHECKOUTS_PER_HOUR) throw new BillingError("rate_limited", 429);
  if (await hasLiveSubscription(admin, args.userId, now)) throw new BillingError("already_subscribed", 409);
  await admin
    .from("billing_subscriptions")
    .update({ status: "expired" })
    .eq("user_id", args.userId)
    .eq("provider", args.provider)
    .eq("interval", args.interval)
    .eq("status", "pending")
    .lt("created_at", new Date(now.getTime() - PENDING_TTL_MS).toISOString());
  const { data } = await admin.from("billing_subscriptions").select("*").eq("user_id", args.userId).eq("provider", args.provider).eq("interval", args.interval).eq("status", "pending").maybeSingle();
  return { existing: (data as SubscriptionRow | null) ?? null };
}

export async function insertPending(
  admin: Admin,
  row: { userId: string; provider: "razorpay" | "paypal"; providerSubscriptionId: string; interval: Interval; amountMinor: number; currency: string; trialDays?: number; planRef?: string; couponId?: string },
): Promise<void> {
  const { error } = await admin.from("billing_subscriptions").insert({
    user_id: row.userId,
    provider: row.provider,
    provider_subscription_id: row.providerSubscriptionId,
    interval: row.interval,
    amount_minor: row.amountMinor,
    currency: row.currency,
    status: "pending",
    // Only written when a coupon chose the trial or the plan, so ordinary checkouts do not depend on migration 13.
    ...(row.couponId ? { coupon_id: row.couponId, trial_days: row.trialDays, plan_ref: row.planRef ?? null } : {}),
  });
  if (error) throw new BillingError("provider_error", 500);
  await audit(admin, { userId: row.userId, provider: row.provider, actor: "checkout", action: "checkout_created", detail: { interval: row.interval, subscription: row.providerSubscriptionId } });
}

/** The subscription a recorded payment belongs to, or null if the payment is not in the ledger (yet). */
export async function subscriptionForPayment(admin: Admin, provider: string, providerPaymentId: string): Promise<SubscriptionRow | null> {
  const { data: pay } = await admin.from("billing_payments").select("subscription_id").eq("provider", provider).eq("provider_payment_id", providerPaymentId).maybeSingle();
  const subId = (pay as { subscription_id: string | null } | null)?.subscription_id;
  if (!subId) return null;
  const { data } = await admin.from("billing_subscriptions").select("*").eq("id", subId).maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}
