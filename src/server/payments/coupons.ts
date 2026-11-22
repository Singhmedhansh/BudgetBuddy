import type { Interval } from "@/config/plans";
import { audit, trialEligible, type Admin } from "./store";
import { BillingError } from "./types";

/**
 * Promotion codes. A code grants a longer free trial (`trial_days`), for example the one printed on an ad. It is looked up,
 * checked and applied only on the server: the browser sends the text and nothing else, and everything a code means (days,
 * plans, limits) comes from the database row.
 */
export interface Coupon {
  id: string;
  code: string;
  campaign: string | null;
  kind: "trial_days";
  trial_days: number;
  intervals: Interval[];
  /** PayPal plans made with this trial length, per billing period. */
  paypal_plan_ids: Partial<Record<Interval, string>>;
  max_redemptions: number | null;
  redeemed_count: number;
  valid_from: string | null;
  valid_until: string | null;
  active: boolean;
}

export type CouponProblem = "unknown" | "not_started" | "expired" | "exhausted" | "interval" | "used" | "not_eligible" | "not_available";

/** Attempts per person per hour. Stops a code being guessed by trying many. */
export const COUPON_CHECKS_PER_HOUR = 20;

/** What people type: spaces and case do not matter. */
export const normalizeCode = (raw: string): string => raw.replace(/\s+/g, "").toUpperCase();
export const validCodeShape = (code: string): boolean => /^[A-Z0-9_-]{3,32}$/.test(code);

/** The reason a code cannot be used right now, or null. Pure: the dates, limits and billing period only. */
export function couponProblem(c: Coupon | null, interval: Interval, now: Date): CouponProblem | null {
  if (!c || !c.active) return "unknown";
  if (c.valid_from && new Date(c.valid_from) > now) return "not_started";
  if (c.valid_until && new Date(c.valid_until) <= now) return "expired";
  if (c.max_redemptions !== null && c.redeemed_count >= c.max_redemptions) return "exhausted";
  if (!c.intervals.includes(interval)) return "interval";
  return null;
}

/** Each problem as a BillingError, so a route can throw it and the person reads a plain sentence. */
export function couponError(p: CouponProblem): BillingError {
  switch (p) {
    case "expired":
      return new BillingError("coupon_expired");
    case "used":
      return new BillingError("coupon_used");
    case "not_eligible":
      return new BillingError("coupon_not_eligible");
    default:
      return new BillingError("coupon_invalid"); // unknown, inactive, not started, used up, wrong period: one message, so codes cannot be probed
  }
}

export async function findCoupon(admin: Admin, rawCode: string): Promise<Coupon | null> {
  const code = normalizeCode(rawCode);
  if (!validCodeShape(code)) return null;
  const { data } = await admin.from("billing_coupons").select("*").eq("code", code).maybeSingle();
  return (data as Coupon | null) ?? null;
}

/**
 * Checks a code for one person and billing period and returns it, or throws the reason. The code applies to a first
 * subscription only (a person who has already subscribed pays from day one), once per person, and for PayPal only if a
 * PayPal plan with that trial length exists for the period.
 */
export async function checkCoupon(admin: Admin, args: { code: string; interval: Interval; userId: string; provider: "razorpay" | "paypal" }, now: Date = new Date()): Promise<Coupon> {
  const { count } = await admin.from("billing_audit").select("id", { count: "exact", head: true }).eq("user_id", args.userId).eq("action", "coupon_check").gte("created_at", new Date(now.getTime() - 3_600_000).toISOString());
  if ((count ?? 0) >= COUPON_CHECKS_PER_HOUR) throw new BillingError("rate_limited", 429);
  await audit(admin, { userId: args.userId, provider: args.provider, actor: "checkout", action: "coupon_check" });

  const coupon = await findCoupon(admin, args.code);
  const problem = couponProblem(coupon, args.interval, now);
  if (problem) throw couponError(problem);
  const c = coupon as Coupon;
  if (!(await trialEligible(admin, args.userId))) throw couponError("not_eligible");
  const { count: used } = await admin.from("billing_coupon_redemptions").select("id", { count: "exact", head: true }).eq("coupon_id", c.id).eq("user_id", args.userId);
  if ((used ?? 0) > 0) throw couponError("used");
  if (args.provider === "paypal" && !c.paypal_plan_ids?.[args.interval]) throw couponError("not_available");
  return c;
}
