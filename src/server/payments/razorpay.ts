import { createHmac, timingSafeEqual } from "node:crypto";
import { planById, priceFor } from "@/config/plans";
import type { RazorpayConfig } from "./config";
import { BillingError, type BillingEvent, type Interval, type PaymentStatus, type SubscriptionStatus } from "./types";

const API = "https://api.razorpay.com/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Razorpay requires a cycle count. Ten years of months, or ten years; the customer can cancel at any time. */
export const TOTAL_COUNT: Record<Interval, number> = { month: 120, year: 10 };

/** What FinTrack One must cost, from the one price list (src/config/plans.ts). Never from the browser. */
export function expectedRazorpayPrice(interval: Interval): { amountMinor: number; currency: "INR" } {
  const price = priceFor(planById("pro"), interval, "INR");
  if (!price) throw new BillingError("interval_unavailable");
  return { amountMinor: price.amountMinor, currency: "INR" };
}

async function call<T>(cfg: RazorpayConfig, method: "GET" | "POST", path: string, body?: unknown, fetcher: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(`${API}${path}`, {
      method,
      headers: { authorization: "Basic " + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64"), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BillingError("provider_error", 502);
  }
  if (res.status === 404) throw new BillingError("not_found", 404);
  if (!res.ok) throw new BillingError("provider_error", 502); // the body is never copied into an error or a log
  return (await res.json()) as T;
}

interface RzPlan { id: string; period: string; interval: number; item: { amount: number; currency: string } }
export interface RzSubscription {
  id: string;
  plan_id: string;
  status: string;
  customer_id?: string | null;
  current_start?: number | null;
  current_end?: number | null;
  start_at?: number | null;
  ended_at?: number | null;
  notes?: { user_id?: string } | unknown[] | null;
  cancel_at_cycle_end?: number | boolean;
  paid_count?: number | null;
  charge_at?: number | null;
}
export interface RzPayment { id: string; amount: number; currency: string; status: string; order_id?: string | null; created_at?: number; error_description?: string | null; amount_refunded?: number; refund_status?: string | null }

/** Confirms the dashboard plan is the price we expect before a customer is ever sent to pay for it. */
export async function assertPlan(cfg: RazorpayConfig, interval: Interval, fetcher?: typeof fetch): Promise<string> {
  const planId = cfg.planIds[interval];
  if (!planId) throw new BillingError("interval_unavailable");
  const want = expectedRazorpayPrice(interval);
  const plan = await call<RzPlan>(cfg, "GET", `/plans/${encodeURIComponent(planId)}`, undefined, fetcher);
  const period = interval === "month" ? "monthly" : "yearly";
  if (plan.item?.amount !== want.amountMinor || plan.item?.currency !== want.currency || plan.period !== period || plan.interval !== 1) throw new BillingError("plan_mismatch");
  return planId;
}

export async function createRazorpaySubscription(cfg: RazorpayConfig, interval: Interval, userId: string, fetcher?: typeof fetch): Promise<{ id: string; amountMinor: number; currency: "INR" }> {
  const planId = await assertPlan(cfg, interval, fetcher);
  const sub = await call<RzSubscription>(cfg, "POST", "/subscriptions", { plan_id: planId, total_count: TOTAL_COUNT[interval], quantity: 1, customer_notify: 1, notes: { user_id: userId, app: "fintrack" } }, fetcher);
  const want = expectedRazorpayPrice(interval);
  return { id: sub.id, amountMinor: want.amountMinor, currency: want.currency };
}

export const getRazorpaySubscription = (cfg: RazorpayConfig, id: string, fetcher?: typeof fetch) => call<RzSubscription>(cfg, "GET", `/subscriptions/${encodeURIComponent(id)}`, undefined, fetcher);
export const getRazorpayPayment = (cfg: RazorpayConfig, id: string, fetcher?: typeof fetch) => call<RzPayment>(cfg, "GET", `/payments/${encodeURIComponent(id)}`, undefined, fetcher);
export const cancelRazorpaySubscription = (cfg: RazorpayConfig, id: string, fetcher?: typeof fetch) => call<RzSubscription>(cfg, "POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: 1 }, fetcher);

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Checkout signature for a subscription payment: HMAC-SHA256 of `payment_id|subscription_id` with the key secret. */
export function verifyCheckoutSignature(paymentId: string, subscriptionId: string, signature: string, keySecret: string): boolean {
  if (!paymentId || !subscriptionId || !signature || !keySecret) return false;
  return safeEqual(createHmac("sha256", keySecret).update(`${paymentId}|${subscriptionId}`).digest("hex"), signature.trim());
}

const iso = (sec: number | null | undefined) => (typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : null);

export function subscriptionStatus(status: string): SubscriptionStatus | null {
  switch (status) {
    case "created":
    case "authenticated":
      return "pending";
    case "active":
      return "active";
    case "pending":
    case "halted":
    case "paused":
      return "past_due";
    case "cancelled":
      return "canceled";
    case "completed":
    case "expired":
      return "expired";
    default:
      return null;
  }
}

const userOf = (notes: RzSubscription["notes"]) => {
  const id = notes && !Array.isArray(notes) ? (notes as { user_id?: string }).user_id : undefined;
  return id && UUID.test(id) ? id : null;
};

/**
 * A checked, synchronous confirmation after the customer pays in Razorpay Checkout. The browser supplies only three
 * identifiers. Everything that decides access is then read from Razorpay by the server: the signature must verify,
 * the subscription must be one this person created for the configured plan, and the payment's amount and currency
 * must equal the price list. Returns the event to record, or throws a BillingError.
 */
export async function confirmRazorpayCheckout(
  cfg: RazorpayConfig,
  input: { paymentId: string; subscriptionId: string; signature: string },
  expect: { userId: string; interval: Interval; amountMinor: number; currency: string },
  fetcher?: typeof fetch,
): Promise<BillingEvent> {
  if (!verifyCheckoutSignature(input.paymentId, input.subscriptionId, input.signature, cfg.keySecret)) throw new BillingError("invalid_signature");
  const [sub, pay] = await Promise.all([getRazorpaySubscription(cfg, input.subscriptionId, fetcher), getRazorpayPayment(cfg, input.paymentId, fetcher)]);
  if (userOf(sub.notes) !== expect.userId) throw new BillingError("owner_mismatch", 403);
  if (sub.plan_id !== cfg.planIds[expect.interval]) throw new BillingError("plan_mismatch");
  if (pay.amount !== expect.amountMinor || pay.currency !== expect.currency) throw new BillingError("amount_mismatch");
  const status = subscriptionStatus(sub.status);
  const paid: PaymentStatus | null = pay.status === "captured" ? "captured" : pay.status === "authorized" ? "authorized" : pay.status === "failed" ? "failed" : null;
  if (!status || !paid) throw new BillingError("provider_error", 502);
  // Access is granted only when Razorpay itself reports the subscription active with a paid-through date.
  const end = iso(sub.current_end);
  const granted = status === "active" && paid === "captured" && end !== null;
  return {
    provider: "razorpay",
    eventId: `verify:${input.paymentId}`,
    eventType: "checkout.verified",
    eventAt: new Date(),
    userId: expect.userId,
    subscription: { provider_subscription_id: sub.id, provider_customer_id: sub.customer_id ?? null, status: granted ? "active" : "pending", current_period_start: iso(sub.current_start), current_period_end: end, started_at: iso(sub.start_at ?? sub.current_start) },
    payment: { provider_payment_id: pay.id, provider_order_id: pay.order_id ?? null, provider_subscription_id: sub.id, amount_minor: pay.amount, currency: pay.currency, status: paid, paid_at: paid === "captured" ? iso(pay.created_at) ?? new Date().toISOString() : null },
  };
}

interface WebhookBody {
  event?: string;
  created_at?: number;
  payload?: { subscription?: { entity?: RzSubscription }; payment?: { entity?: RzPayment & { subscription_id?: string | null } } };
}

/**
 * Normalises a signature-verified Razorpay webhook. Subscription events change access. Payment and refund events only
 * move an existing ledger row forward: they name the payment, not the subscription, so the database finds the person
 * through the payment already on record, and an unknown payment is recorded as unmatched rather than guessed at.
 */
export function razorpayEventToBilling(body: unknown, eventId: string): BillingEvent | null {
  const e = body as WebhookBody;
  const type = e?.event ?? "";
  const sub = e?.payload?.subscription?.entity;
  const pay = e?.payload?.payment?.entity;
  const at = new Date((e?.created_at ?? Date.now() / 1000) * 1000);
  if ((type.startsWith("payment.") || type.startsWith("refund.")) && pay?.id) {
    const status: PaymentStatus | null =
      type.startsWith("refund.") ? (pay.refund_status === "partial" ? "partially_refunded" : pay.refund_status === "full" ? "refunded" : null) : type === "payment.failed" ? "failed" : type === "payment.captured" ? "captured" : null;
    if (!status) return null;
    return { provider: "razorpay", eventId, eventType: type, eventAt: at, userId: null, subscription: null, payment: { provider_payment_id: pay.id, provider_order_id: pay.order_id ?? null, provider_subscription_id: pay.subscription_id ?? null, amount_minor: pay.amount, currency: pay.currency, status, failure_reason: status === "failed" ? pay.error_description ?? "Payment failed" : null, paid_at: status === "captured" ? iso(pay.created_at) : null } };
  }
  if (!type.startsWith("subscription.") || !sub?.id) return null;
  const status = subscriptionStatus(
    { "subscription.authenticated": "authenticated", "subscription.activated": "active", "subscription.charged": "active", "subscription.pending": "pending", "subscription.halted": "halted", "subscription.paused": "paused", "subscription.resumed": "active", "subscription.cancelled": "cancelled", "subscription.completed": "completed", "subscription.updated": sub.status }[type] ?? "",
  );
  if (!status) return null;
  const charged =
    type === "subscription.charged" && pay?.id
      ? { provider_payment_id: pay.id, provider_order_id: pay.order_id ?? null, provider_subscription_id: sub.id, amount_minor: pay.amount, currency: pay.currency, status: (pay.status === "captured" ? "captured" : "authorized") as PaymentStatus, paid_at: iso(pay.created_at) }
      : null;
  // A renewal that could not be charged has no payment entity of its own. It is written to the ledger under an id made
  // from the subscription and how many payments had succeeded so far, so Razorpay's retries of the same renewal
  // (subscription.pending, then halted) are one row, and the next successful charge is a different one.
  const renewalFailed =
    type === "subscription.pending" || type === "subscription.halted"
      ? { provider_payment_id: `renewal_failed:${sub.id}:${sub.paid_count ?? 0}`, provider_subscription_id: sub.id, status: "failed" as PaymentStatus, failure_reason: "Renewal payment failed" }
      : null;
  const payment = charged ?? renewalFailed;
  return {
    provider: "razorpay",
    eventId,
    eventType: type,
    eventAt: at,
    userId: userOf(sub.notes),
    subscription: {
      provider_subscription_id: sub.id,
      provider_customer_id: sub.customer_id ?? null,
      status,
      current_period_start: iso(sub.current_start),
      current_period_end: iso(sub.current_end),
      ...(type === "subscription.cancelled" ? { canceled_at: at.toISOString() } : {}),
    },
    payment,
  };
}

/**
 * Re-reads one subscription from Razorpay for the daily reconcile. It carries the subscription's state only (payments
 * arrive through subscription.charged and the verify step), and it can only confirm or correct a status and period:
 * the database refuses to move a started subscription back to pending or to grant without a paid-through date.
 */
export async function reconcileRazorpaySubscription(cfg: RazorpayConfig, row: { provider_subscription_id: string; user_id: string | null }, eventId: string, fetcher?: typeof fetch, now: Date = new Date()): Promise<BillingEvent | null> {
  const sub = await getRazorpaySubscription(cfg, row.provider_subscription_id, fetcher);
  if (!row.user_id || userOf(sub.notes) !== row.user_id) return null;
  const status = subscriptionStatus(sub.status);
  if (!status) return null;
  return { provider: "razorpay", eventId, eventType: "reconcile", eventAt: now, userId: row.user_id, subscription: { provider_subscription_id: sub.id, status, current_period_start: iso(sub.current_start), current_period_end: iso(sub.current_end) }, payment: null };
}
