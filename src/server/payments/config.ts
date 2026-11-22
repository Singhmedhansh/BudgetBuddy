/**
 * Payments configuration. `LIVE_PAYMENTS_ALLOWED` is a constant, not an environment variable, so a setting cannot flip it.
 * It is on (owner approved on 22 Nov 2026): a live key (rzp_live_…) or PAYPAL_ENVIRONMENT=live is accepted. Real money only moves
 * when live keys are present; with sandbox keys everything stays in test mode.
 * Credentials come from server-only variables and are never exposed to the browser or placed in messages.
 *
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID
 */
export const LIVE_PAYMENTS_ALLOWED = true as boolean;
export type PaymentProvider = "razorpay" | "paypal";

export interface PaymentsStatus {
  mode: "sandbox" | "live";
  /** Providers whose sandbox credentials are present. */
  configured: PaymentProvider[];
  /** True when at least one provider is configured and live payments are allowed. */
  checkoutOpen: boolean;
}

export function paymentsStatus(env: Record<string, string | undefined> = process.env): PaymentsStatus {
  const configured: PaymentProvider[] = [];
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) configured.push("razorpay");
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) configured.push("paypal");
  const live = (env.RAZORPAY_KEY_ID ?? "").startsWith("rzp_live_") || (env.PAYPAL_ENVIRONMENT ?? "").trim().toLowerCase() === "live";
  return { mode: live ? "live" : "sandbox", configured, checkoutOpen: LIVE_PAYMENTS_ALLOWED && configured.length > 0 };
}

// ───────────── provider configuration (server only) ─────────────
// Razorpay:  RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET,
//            RAZORPAY_PLAN_ID_ONE_MONTHLY (and optionally RAZORPAY_PLAN_ID_ONE_YEARLY)
// PayPal:    PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYPAL_ENVIRONMENT=sandbox|live,
//            PAYPAL_PLAN_ID_ONE_MONTHLY (and optionally PAYPAL_PLAN_ID_ONE_YEARLY)
// Plans are created once in each provider's dashboard (or with scripts/billing), so the price a customer is charged
// is fixed on the provider side and re-checked by the server; it is never read from the browser.

import type { Interval } from "@/config/plans";

type Env = Record<string, string | undefined>;
const trim = (v: string | undefined) => v?.trim() || undefined;

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string | undefined;
  mode: "sandbox" | "live";
  planIds: Partial<Record<Interval, string>>;
}

/**
 * Razorpay credentials, or null when they are missing or would mean real money while live payments are not allowed.
 * A key id beginning `rzp_live_` is a live key: with LIVE_PAYMENTS_ALLOWED false it is refused outright, so a
 * production key pasted into a preview deployment cannot charge a real card.
 */
export function razorpayConfig(env: Env = process.env, liveAllowed: boolean = LIVE_PAYMENTS_ALLOWED): RazorpayConfig | null {
  const keyId = trim(env.RAZORPAY_KEY_ID);
  const keySecret = trim(env.RAZORPAY_KEY_SECRET);
  if (!keyId || !keySecret) return null;
  const mode = keyId.startsWith("rzp_live_") ? "live" : "sandbox";
  if (mode === "live" && !liveAllowed) return null;
  return {
    keyId,
    keySecret,
    webhookSecret: trim(env.RAZORPAY_WEBHOOK_SECRET),
    mode,
    planIds: { month: trim(env.RAZORPAY_PLAN_ID_ONE_MONTHLY), year: trim(env.RAZORPAY_PLAN_ID_ONE_YEARLY) },
  };
}

/** True when no Razorpay plan id is set: each payment buys one month or one year of access and does not renew. */
export function isRazorpayOrderMode(cfg: Pick<RazorpayConfig, "planIds">): boolean {
  return !cfg.planIds.month && !cfg.planIds.year;
}

export interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string | undefined;
  mode: "sandbox" | "live";
  baseUrl: string;
  planIds: Partial<Record<Interval, string>>;
  /** The plans that begin with the standard free trial cycle, per billing period. Used only for people who have never subscribed. */
  trialPlanIds?: Partial<Record<Interval, string>>;
}

/** PayPal credentials, or null when missing or when `live` is requested while live payments are not allowed. */
export function paypalConfig(env: Env = process.env, liveAllowed: boolean = LIVE_PAYMENTS_ALLOWED): PaypalConfig | null {
  const clientId = trim(env.PAYPAL_CLIENT_ID);
  const clientSecret = trim(env.PAYPAL_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  const mode = trim(env.PAYPAL_ENVIRONMENT)?.toLowerCase() === "live" ? "live" : "sandbox";
  if (mode === "live" && !liveAllowed) return null;
  return {
    clientId,
    clientSecret,
    webhookId: trim(env.PAYPAL_WEBHOOK_ID),
    mode,
    baseUrl: mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
    planIds: { month: trim(env.PAYPAL_PLAN_ID_ONE_MONTHLY), year: trim(env.PAYPAL_PLAN_ID_ONE_YEARLY) },
    trialPlanIds: { month: trim(env.PAYPAL_PLAN_ID_ONE_MONTHLY_TRIAL), year: trim(env.PAYPAL_PLAN_ID_ONE_YEARLY_TRIAL) },
  };
}

/** What the UI may know: which providers can start a checkout right now. Never keys, ids or modes of secrets. */
export function checkoutProviders(env: Env = process.env): { razorpay: Interval[]; paypal: Interval[]; paypalTrial: Interval[]; testMode: boolean } {
  const rz = razorpayConfig(env);
  const pp = paypalConfig(env);
  const intervals = (c: { planIds: Partial<Record<Interval, string>> } | null) => (c ? (Object.entries(c.planIds).filter(([, v]) => v).map(([k]) => k) as Interval[]) : []);
  // Razorpay with no plan ids configured sells one-time prepaid periods (Standard Checkout with the Orders API).
  const razorpay: Interval[] = rz ? (isRazorpayOrderMode(rz) ? ["month", "year"] : intervals(rz)) : [];
  const paypalTrial = pp ? (Object.entries(pp.trialPlanIds ?? {}).filter(([, v]) => v).map(([k]) => k) as Interval[]) : [];
  return { razorpay, paypal: intervals(pp), paypalTrial, testMode: [rz, pp].some((c) => c && c.mode === "sandbox") };
}
