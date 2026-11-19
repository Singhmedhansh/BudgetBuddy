import type { PaypalConfig } from "./config";
import { BillingError, type BillingEvent, type Interval, type PaymentPatch, type PaymentStatus, type SubscriptionStatus } from "./types";

/** International customers pay in the currency of the PayPal plan. PayPal does not take INR from most merchants. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let tokenCache: { key: string; token: string; expires: number } | null = null;

async function token(cfg: PaypalConfig, fetcher: typeof fetch): Promise<string> {
  const key = `${cfg.baseUrl}:${cfg.clientId}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expires > Date.now() + 30_000) return tokenCache.token;
  let res: Response;
  try {
    res = await fetcher(`${cfg.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BillingError("provider_error", 502);
  }
  if (!res.ok) throw new BillingError("provider_error", 502);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new BillingError("provider_error", 502);
  tokenCache = { key, token: j.access_token, expires: Date.now() + (j.expires_in ?? 300) * 1000 };
  return j.access_token;
}

async function call<T>(cfg: PaypalConfig, method: "GET" | "POST", path: string, body?: unknown, fetcher: typeof fetch = fetch, extra: Record<string, string> = {}): Promise<T> {
  const bearer = await token(cfg, fetcher);
  let res: Response;
  try {
    res = await fetcher(`${cfg.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new BillingError("provider_error", 502);
  }
  if (res.status === 404) throw new BillingError("not_found", 404);
  if (!res.ok) throw new BillingError("provider_error", 502); // the body is never copied into an error or a log
  return res.status === 204 ? ({} as T) : ((await res.json()) as T);
}

interface PpPlan {
  id: string;
  status: string;
  billing_cycles?: { tenure_type: string; frequency: { interval_unit: string; interval_count: number }; pricing_scheme?: { fixed_price?: { value: string; currency_code: string } } }[];
}
export interface PpSubscription {
  id: string;
  plan_id: string;
  status: string;
  custom_id?: string | null;
  start_time?: string;
  subscriber?: { payer_id?: string };
  billing_info?: { next_billing_time?: string | null; last_payment?: { amount?: { currency_code: string; value: string }; time?: string }; failed_payments_count?: number };
  links?: { rel: string; href: string }[];
}

export interface PpTransaction {
  id: string;
  status: string;
  time?: string;
  amount_with_breakdown?: { gross_amount?: { currency_code: string; value: string } };
}

const minorOf = (value: string) => Math.round(Number(value) * 100);

/**
 * Every payment of a subscription, as PayPal records it: the real transaction id (the same id PayPal's sale and refund
 * webhooks name), its amount, and whether it completed, was declined or has been refunded. This is the source of the
 * payment ledger, so refunds and failed renewals are matched to the payment they belong to.
 */
export async function listPaypalTransactions(cfg: PaypalConfig, id: string, sinceIso: string, now: Date = new Date(), fetcher: typeof fetch = fetch): Promise<PpTransaction[]> {
  const q = `start_time=${encodeURIComponent(sinceIso)}&end_time=${encodeURIComponent(now.toISOString())}`;
  const r = await call<{ transactions?: PpTransaction[] }>(cfg, "GET", `/v1/billing/subscriptions/${encodeURIComponent(id)}/transactions?${q}`, undefined, fetcher);
  return r.transactions ?? [];
}

/** The price PayPal will charge for a plan, read from PayPal by the server. Confirms the plan is live and the right interval. */
export async function readPlanPrice(cfg: PaypalConfig, interval: Interval, fetcher: typeof fetch = fetch): Promise<{ planId: string; amountMinor: number; currency: string }> {
  const planId = cfg.planIds[interval];
  if (!planId) throw new BillingError("interval_unavailable");
  const plan = await call<PpPlan>(cfg, "GET", `/v1/billing/plans/${encodeURIComponent(planId)}`, undefined, fetcher);
  const regular = (plan.billing_cycles ?? []).filter((c) => c.tenure_type === "REGULAR");
  const unit = interval === "month" ? "MONTH" : "YEAR";
  const price = regular[0]?.pricing_scheme?.fixed_price;
  // One regular cycle, no trial pricing games: the plan must be active, charge once per interval, and have a price.
  if (plan.status !== "ACTIVE" || regular.length !== 1 || regular[0].frequency.interval_unit !== unit || regular[0].frequency.interval_count !== 1 || !price) throw new BillingError("plan_mismatch");
  const amountMinor = minorOf(price.value);
  if (!(amountMinor > 0) || !/^[A-Z]{3}$/.test(price.currency_code)) throw new BillingError("plan_mismatch");
  return { planId, amountMinor, currency: price.currency_code };
}

export async function createPaypalSubscription(cfg: PaypalConfig, interval: Interval, userId: string, urls: { returnUrl: string; cancelUrl: string; brand: string }, fetcher: typeof fetch = fetch) {
  const price = await readPlanPrice(cfg, interval, fetcher);
  const sub = await call<PpSubscription>(
    cfg,
    "POST",
    "/v1/billing/subscriptions",
    { plan_id: price.planId, custom_id: userId, application_context: { brand_name: urls.brand, shipping_preference: "NO_SHIPPING", user_action: "SUBSCRIBE_NOW", return_url: urls.returnUrl, cancel_url: urls.cancelUrl } },
    fetcher,
    { "PayPal-Request-Id": `fintrack-${userId}-${interval}-${Math.floor(Date.now() / 600_000)}`, prefer: "return=representation" },
  );
  const approve = sub.links?.find((l) => l.rel === "approve")?.href;
  if (!sub.id || !approve || !/^https:\/\/([a-z0-9-]+\.)*paypal\.com\//.test(approve)) throw new BillingError("provider_error", 502);
  return { id: sub.id, approveUrl: approve, amountMinor: price.amountMinor, currency: price.currency };
}

export const getPaypalSubscription = (cfg: PaypalConfig, id: string, fetcher: typeof fetch = fetch) => call<PpSubscription>(cfg, "GET", `/v1/billing/subscriptions/${encodeURIComponent(id)}`, undefined, fetcher);
export const cancelPaypalSubscription = (cfg: PaypalConfig, id: string, fetcher: typeof fetch = fetch) => call<unknown>(cfg, "POST", `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: "Cancelled by the customer in FinTrack" }, fetcher);

export function paypalStatus(status: string): SubscriptionStatus | null {
  switch (status) {
    case "APPROVAL_PENDING":
    case "APPROVED":
      return "pending";
    case "ACTIVE":
      return "active";
    case "SUSPENDED":
      return "past_due";
    case "CANCELLED":
      return "canceled";
    case "EXPIRED":
      return "expired";
    default:
      return null;
  }
}

const TX_STATUS: Record<string, PaymentStatus | undefined> = { COMPLETED: "captured", PARTIALLY_REFUNDED: "partially_refunded", REFUNDED: "refunded", DECLINED: "failed", PENDING: "authorized" };

/**
 * Turns PayPal's own, freshly read subscription and its transactions into the state to record. Used for the return
 * from PayPal, every webhook and the daily reconcile: the callback or event only says "look again"; what is recorded
 * is what PayPal reports now, checked against what the server expected when the checkout began (person, plan, amount,
 * currency). Every transaction becomes a ledger row under its real id, so a refund or a declined renewal lands on the
 * payment it belongs to.
 */
export function paypalStateToBilling(
  sub: PpSubscription,
  expect: { userId: string; planId: string; amountMinor: number; currency: string },
  ids: { eventId: string; eventType: string },
  now: Date = new Date(),
  transactions: PpTransaction[] = [],
): BillingEvent {
  if (!sub.custom_id || !UUID.test(sub.custom_id) || sub.custom_id !== expect.userId) throw new BillingError("owner_mismatch", 403);
  if (sub.plan_id !== expect.planId) throw new BillingError("plan_mismatch");
  const status = paypalStatus(sub.status);
  if (!status) throw new BillingError("provider_error", 502);
  const payments: PaymentPatch[] = [];
  for (const t of transactions) {
    const mapped = TX_STATUS[t.status];
    const gross = t.amount_with_breakdown?.gross_amount;
    if (!mapped || !t.id || !gross) continue;
    // The money actually taken must be the price on record. Anything else is never turned into access.
    if (mapped !== "failed" && (minorOf(gross.value) !== expect.amountMinor || gross.currency_code !== expect.currency)) throw new BillingError("amount_mismatch");
    payments.push({
      provider_payment_id: t.id,
      provider_subscription_id: sub.id,
      amount_minor: expect.amountMinor,
      currency: expect.currency,
      status: mapped,
      failure_reason: mapped === "failed" ? "Payment declined" : null,
      paid_at: mapped === "failed" || mapped === "authorized" ? null : t.time ?? null,
    });
  }
  const paid = payments.some((p) => p.status === "captured" || p.status === "partially_refunded" || p.status === "refunded");
  const last = [...payments].filter((p) => p.paid_at).sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))[0];
  const next = sub.billing_info?.next_billing_time ?? null;
  // ACTIVE needs both a recorded payment and a renewal date; otherwise the plan is not granted.
  const granted = status === "active" && paid && next !== null;
  return {
    provider: "paypal",
    eventId: ids.eventId,
    eventType: ids.eventType,
    eventAt: now,
    userId: expect.userId,
    subscription: {
      provider_subscription_id: sub.id,
      provider_customer_id: sub.subscriber?.payer_id ?? null,
      status: status === "active" && !granted ? "pending" : status,
      current_period_start: last?.paid_at ?? null,
      current_period_end: next,
      started_at: sub.start_time ?? null,
      ...(status === "canceled" ? { canceled_at: now.toISOString() } : {}),
    },
    payment: payments.length ? payments : null,
  };
}

/** Reads the subscription and its payments from PayPal and returns the state to record. One place, used by every caller. */
export async function syncPaypalSubscription(
  cfg: PaypalConfig,
  row: { provider_subscription_id: string; user_id: string | null; interval: Interval; amount_minor: number; currency: string; created_at: string },
  ids: { eventId: string; eventType: string },
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<BillingEvent> {
  const planId = cfg.planIds[row.interval];
  if (!planId) throw new BillingError("interval_unavailable");
  if (!row.user_id) throw new BillingError("owner_mismatch", 403);
  // From a day before the checkout began; if the stored date is unreadable, look back a bounded 400 days instead.
  const created = new Date(row.created_at).getTime();
  const since = new Date((Number.isFinite(created) ? Math.min(created, now.getTime()) : now.getTime() - 400 * 86_400_000) - 86_400_000).toISOString();
  const [sub, transactions] = await Promise.all([getPaypalSubscription(cfg, row.provider_subscription_id, fetcher), listPaypalTransactions(cfg, row.provider_subscription_id, since, now, fetcher)]);
  return paypalStateToBilling(sub, { userId: row.user_id, planId, amountMinor: row.amount_minor, currency: row.currency }, ids, now, transactions);
}

/** The PayPal verification call: PayPal itself checks the signature of the webhook delivery. */
export async function verifyPaypalWebhook(cfg: PaypalConfig, headers: Headers, event: unknown, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!cfg.webhookId) return false;
  const h = (n: string) => headers.get(n);
  const [algo, cert, id, sig, time] = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"].map(h);
  if (!algo || !cert || !id || !sig || !time) return false;
  // The certificate must be PayPal's: an attacker-supplied URL would let them "verify" their own forgery.
  if (!/^https:\/\/api(-m)?(\.sandbox)?\.paypal\.com\//.test(cert)) return false;
  try {
    const r = await call<{ verification_status?: string }>(cfg, "POST", "/v1/notifications/verify-webhook-signature", { auth_algo: algo, cert_url: cert, transmission_id: id, transmission_sig: sig, transmission_time: time, webhook_id: cfg.webhookId, webhook_event: event }, fetcher);
    return r.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

/** Subscription id carried by a PayPal webhook, for the events that concern a subscription or one of its payments. */
export function paypalEventSubscriptionId(event: unknown): string | null {
  const e = event as { event_type?: string; resource?: { id?: string; billing_agreement_id?: string } };
  const type = e?.event_type ?? "";
  if (type.startsWith("BILLING.SUBSCRIPTION.")) return e.resource?.id ?? null;
  if (type === "PAYMENT.SALE.COMPLETED" || type === "PAYMENT.SALE.DENIED" || type === "PAYMENT.SALE.PENDING") return e.resource?.billing_agreement_id ?? null;
  return null;
}

/**
 * Refund and reversal events name the original payment (the sale), not the subscription. The route finds the
 * subscription through the payment already in the ledger and then re-reads PayPal's transactions for it.
 */
export function paypalEventSaleId(event: unknown): string | null {
  const e = event as { event_type?: string; resource?: { sale_id?: string; id?: string } };
  const type = e?.event_type ?? "";
  if (type === "PAYMENT.SALE.REFUNDED" || type === "PAYMENT.SALE.REVERSED") return e.resource?.sale_id ?? null;
  return null;
}
