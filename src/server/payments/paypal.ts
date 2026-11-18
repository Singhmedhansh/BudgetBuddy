import type { PaypalConfig } from "./config";
import { BillingError, type BillingEvent, type Interval, type PaymentStatus, type SubscriptionStatus } from "./types";

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

const minorOf = (value: string) => Math.round(Number(value) * 100);

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

/**
 * Turns PayPal's own, freshly read subscription into the state to record. Used for the return from PayPal and for
 * every webhook: the callback or event only says "look again"; what is recorded is what PayPal reports now, checked
 * against what the server expected when the checkout began (person, plan, amount, currency).
 */
export function paypalStateToBilling(
  sub: PpSubscription,
  expect: { userId: string; planId: string; amountMinor: number; currency: string },
  ids: { eventId: string; eventType: string },
  now: Date = new Date(),
): BillingEvent {
  if (!sub.custom_id || !UUID.test(sub.custom_id) || sub.custom_id !== expect.userId) throw new BillingError("owner_mismatch", 403);
  if (sub.plan_id !== expect.planId) throw new BillingError("plan_mismatch");
  const status = paypalStatus(sub.status);
  if (!status) throw new BillingError("provider_error", 502);
  const last = sub.billing_info?.last_payment;
  let payment: BillingEvent["payment"] = null;
  if (last?.amount && last.time) {
    // The money actually taken must be the price on record. Anything else is never turned into access.
    if (minorOf(last.amount.value) !== expect.amountMinor || last.amount.currency_code !== expect.currency) throw new BillingError("amount_mismatch");
    payment = { provider_payment_id: `${sub.id}:${last.time}`, provider_subscription_id: sub.id, amount_minor: expect.amountMinor, currency: expect.currency, status: "captured" as PaymentStatus, paid_at: last.time };
  }
  const next = sub.billing_info?.next_billing_time ?? null;
  // ACTIVE needs both a recorded payment and a renewal date; otherwise the plan is not granted.
  const granted = status === "active" && payment !== null && next !== null;
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
      current_period_start: last?.time ?? null,
      current_period_end: next,
      started_at: sub.start_time ?? null,
      ...(status === "canceled" ? { canceled_at: now.toISOString() } : {}),
    },
    payment,
  };
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
  if (type.startsWith("PAYMENT.SALE.")) return e.resource?.billing_agreement_id ?? null;
  return null;
}
