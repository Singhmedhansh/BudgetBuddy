import { createHmac, timingSafeEqual } from "node:crypto";
import { planById, priceFor, TRIAL_DAYS } from "@/config/plans";
import type { RazorpayConfig } from "./config";
import { BillingError, type BillingEvent, type Interval, type PaymentStatus, type SubscriptionStatus } from "./types";

const API = "https://api.razorpay.com/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Razorpay requires a cycle count. Ten years of months, or ten years; the customer can cancel at any time. */
export const TOTAL_COUNT: Record<Interval, number> = { month: 120, year: 10 };

/**
 * Authentication charges. When a subscription starts later (a free trial), Razorpay takes a small charge to set up the
 * mandate and refunds it. It is not a purchase: it never becomes a ledger row, an invoice or access, and a refund of it
 * must never end anyone's access. Anything at or below this amount is treated that way.
 */
export const AUTH_CHARGE_MAX_MINOR = 1000;

/** True when the subscription's first charge is the trial end this checkout asked for (created + the trial length, within 15 minutes). */
export function isTrialStart(startAtSec: number | null | undefined, createdAtIso: string | null | undefined, days: number = TRIAL_DAYS): boolean {
  if (typeof startAtSec !== "number" || !createdAtIso) return false;
  const created = new Date(createdAtIso).getTime();
  return Number.isFinite(created) && Math.abs(startAtSec * 1000 - (created + days * 86_400_000)) <= 15 * 60_000;
}

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

export async function createRazorpaySubscription(cfg: RazorpayConfig, interval: Interval, userId: string, fetcher?: typeof fetch, opts: { trialDays?: number; now?: Date } = {}): Promise<{ id: string; amountMinor: number; currency: "INR"; trialEndsAt: string | null }> {
  const planId = await assertPlan(cfg, interval, fetcher);
  // A trial defers the first charge: the person authorises a mandate now and Razorpay charges the plan price on this date.
  const startAt = opts.trialDays && opts.trialDays > 0 ? Math.floor(((opts.now ?? new Date()).getTime() + opts.trialDays * 86_400_000) / 1000) : null;
  const sub = await call<RzSubscription>(cfg, "POST", "/subscriptions", { plan_id: planId, total_count: TOTAL_COUNT[interval], quantity: 1, customer_notify: 1, ...(startAt ? { start_at: startAt } : {}), notes: { user_id: userId, app: "fintrack", ...(startAt ? { trial_days: String(opts.trialDays) } : {}) } }, fetcher);
  const want = expectedRazorpayPrice(interval);
  return { id: sub.id, amountMinor: want.amountMinor, currency: want.currency, trialEndsAt: startAt ? new Date(startAt * 1000).toISOString() : null };
}

/** Prepaid access bought with one payment: the period starts when the payment is confirmed. */
export function periodEnd(start: Date, interval: Interval): Date {
  const d = new Date(start);
  if (interval === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

interface RzOrder { id: string; amount: number; currency: string; status: string; notes?: { user_id?: string; interval?: string } | unknown[] | null }

/** Step 1 of Standard Checkout: an order for exactly the price-list amount. Nothing about the price comes from the browser. */
export async function createRazorpayOrder(cfg: RazorpayConfig, interval: Interval, userId: string, fetcher?: typeof fetch): Promise<{ id: string; amountMinor: number; currency: "INR" }> {
  const want = expectedRazorpayPrice(interval);
  if (want.amountMinor < 100) throw new BillingError("interval_unavailable"); // Razorpay's minimum is 100 paise
  const order = await call<RzOrder>(cfg, "POST", "/orders", { amount: want.amountMinor, currency: want.currency, receipt: `ft_${userId.slice(0, 8)}_${Date.now().toString(36)}`, notes: { user_id: userId, interval, app: "fintrack" } }, fetcher);
  return { id: order.id, amountMinor: want.amountMinor, currency: want.currency };
}

export const getRazorpayOrder = (cfg: RazorpayConfig, id: string, fetcher?: typeof fetch) => call<RzOrder>(cfg, "GET", `/orders/${encodeURIComponent(id)}`, undefined, fetcher);
export const captureRazorpayPayment = (cfg: RazorpayConfig, id: string, amount: number, currency: string, fetcher?: typeof fetch) => call<RzPayment>(cfg, "POST", `/payments/${encodeURIComponent(id)}/capture`, { amount, currency }, fetcher);

/** Standard Checkout signature: HMAC-SHA256 of `order_id|payment_id` with the key secret. */
export function verifyOrderSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  return safeEqual(createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex"), signature.trim());
}

/**
 * Confirms a one-time Standard Checkout payment. The signature must verify; then the order and payment are read back
 * from Razorpay and must belong to this person, this order, and the amount and currency recorded when checkout began.
 * An authorised-only payment is captured by the server. Access is granted only for a captured payment, from now to the
 * end of the purchased period.
 */
export async function confirmRazorpayOrderPayment(
  cfg: RazorpayConfig,
  input: { paymentId: string; orderId: string; signature: string },
  expect: { userId: string; interval: Interval; amountMinor: number; currency: string },
  fetcher?: typeof fetch,
  now: Date = new Date(),
): Promise<BillingEvent> {
  if (!verifyOrderSignature(input.orderId, input.paymentId, input.signature, cfg.keySecret)) throw new BillingError("invalid_signature");
  const [order, initial] = await Promise.all([getRazorpayOrder(cfg, input.orderId, fetcher), getRazorpayPayment(cfg, input.paymentId, fetcher)]);
  if (userOf(order.notes as RzSubscription["notes"]) !== expect.userId) throw new BillingError("owner_mismatch", 403);
  if (initial.order_id !== input.orderId) throw new BillingError("plan_mismatch");
  if (order.amount !== expect.amountMinor || order.currency !== expect.currency || initial.amount !== expect.amountMinor || initial.currency !== expect.currency) throw new BillingError("amount_mismatch");
  return orderPaymentEvent(cfg, initial, input.orderId, expect, fetcher, now);
}

/** Captures an authorised payment, then describes the result as one ledger event. Access only for a captured payment. */
async function orderPaymentEvent(cfg: RazorpayConfig, initial: RzPayment, orderId: string, expect: { userId: string; interval: Interval; amountMinor: number; currency: string }, fetcher: typeof fetch | undefined, now: Date): Promise<BillingEvent> {
  let pay = initial;
  if (pay.status === "authorized") pay = await captureRazorpayPayment(cfg, pay.id, expect.amountMinor, expect.currency, fetcher);
  const paid: PaymentStatus | null = pay.status === "captured" ? "captured" : pay.status === "failed" ? "failed" : pay.status === "authorized" ? "authorized" : null;
  if (!paid) throw new BillingError("provider_error", 502);
  const granted = paid === "captured";
  const end = periodEnd(now, expect.interval);
  return {
    provider: "razorpay",
    eventId: `verify:${pay.id}`, // the same id whether the browser, the status check or the cron reports it, so it is applied once
    eventType: "checkout.verified",
    eventAt: now,
    userId: expect.userId,
    subscription: { provider_subscription_id: orderId, status: granted ? "active" : "pending", ...(granted ? { current_period_start: now.toISOString(), current_period_end: end.toISOString(), started_at: now.toISOString() } : {}) },
    payment: { provider_payment_id: pay.id, provider_order_id: orderId, provider_subscription_id: orderId, amount_minor: pay.amount, currency: pay.currency, status: paid, paid_at: granted ? now.toISOString() : null },
  };
}

/**
 * Asks Razorpay whether an order was paid, without relying on the browser (closed tab, lost connection, missed
 * webhook). Reads the order and its payments; a captured (or capturable) payment for exactly the expected amount
 * becomes the same ledger event the checkout step would have written. Returns null when nothing has been paid.
 */
export async function syncRazorpayOrder(
  cfg: RazorpayConfig,
  row: { provider_subscription_id: string; user_id: string | null; interval: Interval; amount_minor: number; currency: string },
  fetcher?: typeof fetch,
  now: Date = new Date(),
): Promise<BillingEvent | null> {
  if (!row.user_id || !row.provider_subscription_id.startsWith("order_")) return null;
  const expect = { userId: row.user_id, interval: row.interval, amountMinor: row.amount_minor, currency: row.currency };
  const order = await getRazorpayOrder(cfg, row.provider_subscription_id, fetcher);
  if (userOf(order.notes as RzSubscription["notes"]) !== row.user_id || order.amount !== expect.amountMinor || order.currency !== expect.currency) return null;
  const list = await call<{ items?: RzPayment[] }>(cfg, "GET", `/orders/${encodeURIComponent(row.provider_subscription_id)}/payments`, undefined, fetcher);
  const hit = (list.items ?? []).find((p) => (p.status === "captured" || p.status === "authorized") && p.amount === expect.amountMinor && p.currency === expect.currency && p.order_id === row.provider_subscription_id);
  return hit ? orderPaymentEvent(cfg, hit, row.provider_subscription_id, expect, fetcher, now) : null;
}

export const getRazorpaySubscription = (cfg: RazorpayConfig, id: string, fetcher?: typeof fetch) => call<RzSubscription>(cfg, "GET", `/subscriptions/${encodeURIComponent(id)}`, undefined, fetcher);
export const getRazorpayPayment = (cfg: RazorpayConfig, id: string, fetcher?: typeof fetch) => call<RzPayment>(cfg, "GET", `/payments/${encodeURIComponent(id)}`, undefined, fetcher);
/**
 * Stops a subscription. One that is already charging stops at the end of the paid cycle. One that has not been charged yet
 * (a free trial, status `authenticated`) has no cycle to finish, so it is cancelled at once: the first charge never happens.
 * Returns whether it was cancelled immediately.
 */
export async function cancelRazorpaySubscription(cfg: RazorpayConfig, id: string, fetcher?: typeof fetch): Promise<{ immediate: boolean }> {
  const current = await getRazorpaySubscription(cfg, id, fetcher);
  const immediate = current.status === "authenticated" || current.status === "created";
  await call<RzSubscription>(cfg, "POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: immediate ? 0 : 1 }, fetcher);
  return { immediate };
}

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
  expect: { userId: string; interval: Interval; amountMinor: number; currency: string; createdAt?: string; trialDays?: number },
  fetcher?: typeof fetch,
  now: Date = new Date(),
): Promise<BillingEvent> {
  if (!verifyCheckoutSignature(input.paymentId, input.subscriptionId, input.signature, cfg.keySecret)) throw new BillingError("invalid_signature");
  const [sub, pay] = await Promise.all([getRazorpaySubscription(cfg, input.subscriptionId, fetcher), getRazorpayPayment(cfg, input.paymentId, fetcher)]);
  if (userOf(sub.notes) !== expect.userId) throw new BillingError("owner_mismatch", 403);
  if (sub.plan_id !== cfg.planIds[expect.interval]) throw new BillingError("plan_mismatch");
  // A free trial: the mandate is authorised now and the plan price is charged by Razorpay on the trial end date. What is
  // checked is Razorpay's own record (this person's subscription, this plan, an authorised mandate, the trial end date we
  // asked for). The small authentication charge is not a purchase and is never recorded.
  if (isTrialStart(sub.start_at, expect.createdAt, expect.trialDays ?? TRIAL_DAYS)) {
    const trialEnd = iso(sub.start_at);
    const authorised = sub.status === "authenticated" || sub.status === "active";
    if (!trialEnd || new Date(trialEnd) <= now || !authorised) throw new BillingError("provider_error", 502);
    if (pay.currency !== expect.currency || pay.amount > AUTH_CHARGE_MAX_MINOR || pay.status === "failed") throw new BillingError("amount_mismatch");
    return trialEvent(sub.id, sub.customer_id ?? null, `verify:trial:${sub.id}`, "checkout.verified", expect.userId, trialEnd, now);
  }
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

/** Access for the free days of a trial: from now to the first charge. No payment is recorded (see AUTH_CHARGE_MAX_MINOR). */
function trialEvent(subscriptionId: string, customerId: string | null, eventId: string, eventType: string, userId: string | null, trialEndIso: string, at: Date): BillingEvent {
  return {
    provider: "razorpay",
    eventId,
    eventType,
    eventAt: at,
    userId,
    subscription: { provider_subscription_id: subscriptionId, provider_customer_id: customerId, status: "active", current_period_start: at.toISOString(), current_period_end: trialEndIso, started_at: at.toISOString() },
    payment: null,
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
    if (pay.amount <= AUTH_CHARGE_MAX_MINOR) return null; // a mandate authentication charge and its refund are not purchases
    const status: PaymentStatus | null =
      type.startsWith("refund.") ? (pay.refund_status === "partial" ? "partially_refunded" : pay.refund_status === "full" ? "refunded" : null) : type === "payment.failed" ? "failed" : type === "payment.captured" ? "captured" : null;
    if (!status) return null;
    return { provider: "razorpay", eventId, eventType: type, eventAt: at, userId: null, subscription: null, payment: { provider_payment_id: pay.id, provider_order_id: pay.order_id ?? null, provider_subscription_id: pay.subscription_id ?? null, amount_minor: pay.amount, currency: pay.currency, status, failure_reason: status === "failed" ? pay.error_description ?? "Payment failed" : null, paid_at: status === "captured" ? iso(pay.created_at) : null } };
  }
  if (!type.startsWith("subscription.") || !sub?.id) return null;
  // The mandate was authorised and the first charge is still in the future: that is a free trial running until then.
  if (type === "subscription.authenticated" && sub.status === "authenticated" && typeof sub.start_at === "number" && sub.start_at * 1000 > at.getTime()) {
    return trialEvent(sub.id, sub.customer_id ?? null, eventId, type, userOf(sub.notes), iso(sub.start_at)!, at);
  }
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
  if (row.provider_subscription_id.startsWith("order_")) return null; // a one-time purchase has nothing to re-read; the daily sweep ends it
  const sub = await getRazorpaySubscription(cfg, row.provider_subscription_id, fetcher);
  if (!row.user_id || userOf(sub.notes) !== row.user_id) return null;
  const status = subscriptionStatus(sub.status);
  if (!status) return null;
  return { provider: "razorpay", eventId, eventType: "reconcile", eventAt: now, userId: row.user_id, subscription: { provider_subscription_id: sub.id, status, current_period_start: iso(sub.current_start), current_period_end: iso(sub.current_end) }, payment: null };
}
