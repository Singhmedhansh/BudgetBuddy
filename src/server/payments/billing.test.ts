import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkoutProviders, paypalConfig, razorpayConfig, type PaypalConfig, type RazorpayConfig } from "./config";
import { createPaypalSubscription, listPaypalTransactions, paypalEventSaleId, paypalEventSubscriptionId, paypalStateToBilling, paypalStatus, readPlanPrice, syncPaypalSubscription, verifyPaypalWebhook, type PpSubscription, type PpTransaction } from "./paypal";
import { assertPlan, confirmRazorpayCheckout, createRazorpaySubscription, expectedRazorpayPrice, razorpayEventToBilling, reconcileRazorpaySubscription, subscriptionStatus, verifyCheckoutSignature } from "./razorpay";
import { BillingError, type BillingEvent } from "./types";

/** The first (or only) payment of an event, whichever shape it carries. */
const firstPayment = (p: BillingEvent["payment"]) => (Array.isArray(p) ? p[0] : p);
const allPayments = (p: BillingEvent["payment"]) => (p == null ? [] : Array.isArray(p) ? p : [p]);

const UID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const SECRET = "rzp_test_secret_value";
const rz: RazorpayConfig = { keyId: "rzp_test_abc", keySecret: SECRET, webhookSecret: "whsec", mode: "sandbox", planIds: { month: "plan_M", year: "plan_Y" } };
const pp: PaypalConfig = { clientId: "cid", clientSecret: "csecret", webhookId: "WH-1", mode: "sandbox", baseUrl: "https://api-m.sandbox.paypal.com", planIds: { month: "P-MONTH" } };

const sign = (pay: string, sub: string, secret = SECRET) => createHmac("sha256", secret).update(`${pay}|${sub}`).digest("hex");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** A fetch that answers by URL substring and records what was asked. */
const router = (routes: Record<string, unknown | (() => Response)>) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    if (!hit) return json({ error: "unrouted" }, 500);
    const v = routes[hit];
    return typeof v === "function" ? (v as () => Response)() : json(v);
  }) as unknown as typeof fetch;
  return Object.assign(f, { calls });
};
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof BillingError ? e.code : "other"));

describe("payment configuration", () => {
  it("never accepts live credentials while live payments are disallowed in code", () => {
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "rzp_live_abc", RAZORPAY_KEY_SECRET: "s" })).toBeNull();
    expect(paypalConfig({ PAYPAL_CLIENT_ID: "c", PAYPAL_CLIENT_SECRET: "s", PAYPAL_ENVIRONMENT: "live" })).toBeNull();
  });
  it("accepts sandbox credentials and keeps the environments apart", () => {
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "s" })?.mode).toBe("sandbox");
    expect(paypalConfig({ PAYPAL_CLIENT_ID: "c", PAYPAL_CLIENT_SECRET: "s" })?.baseUrl).toBe("https://api-m.sandbox.paypal.com");
    expect(paypalConfig({ PAYPAL_CLIENT_ID: "c", PAYPAL_CLIENT_SECRET: "s", PAYPAL_ENVIRONMENT: "live" }, true)?.baseUrl).toBe("https://api-m.paypal.com");
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "rzp_live_abc", RAZORPAY_KEY_SECRET: "s" }, true)?.mode).toBe("live");
  });
  it("is unconfigured without both id and secret", () => {
    expect(razorpayConfig({ RAZORPAY_KEY_ID: "rzp_test_abc" })).toBeNull();
    expect(paypalConfig({ PAYPAL_CLIENT_ID: "c" })).toBeNull();
  });
  it("tells the UI only which providers and periods are available, never ids or secrets", () => {
    const s = checkoutProviders({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "SECRETVALUE", RAZORPAY_PLAN_ID_ONE_MONTHLY: "plan_M", PAYPAL_CLIENT_ID: "c", PAYPAL_CLIENT_SECRET: "s" });
    expect(s).toEqual({ razorpay: ["month"], paypal: [], testMode: true });
    expect(JSON.stringify(s)).not.toMatch(/SECRETVALUE|plan_M|rzp_/);
  });
});

describe("Razorpay: price and plan", () => {
  it("the expected price comes from the one price list: INR 149 a month", () => {
    expect(expectedRazorpayPrice("month")).toEqual({ amountMinor: 14900, currency: "INR" });
    expect(expectedRazorpayPrice("year")).toEqual({ amountMinor: 119900, currency: "INR" });
  });
  const plan = (over = {}) => ({ id: "plan_M", period: "monthly", interval: 1, item: { amount: 14900, currency: "INR" }, ...over });
  it("a dashboard plan with the right price is accepted", async () => {
    expect(await assertPlan(rz, "month", router({ "/plans/plan_M": plan() }))).toBe("plan_M");
  });
  it.each([
    ["wrong amount", { item: { amount: 9900, currency: "INR" } }],
    ["wrong currency", { item: { amount: 14900, currency: "USD" } }],
    ["wrong period", { period: "yearly" }],
    ["wrong interval count", { interval: 3 }],
  ])("refuses a plan with the %s before any customer is sent to it", async (_n, over) => {
    expect(await code(assertPlan(rz, "month", router({ "/plans/plan_M": plan(over) })))).toBe("plan_mismatch");
  });
  it("an unconfigured period is unavailable", async () => {
    expect(await code(assertPlan({ ...rz, planIds: {} }, "month", router({})))).toBe("interval_unavailable");
  });
  it("creating a subscription sends the server-chosen plan and the user in notes, and no price", async () => {
    const f = router({ "/plans/plan_M": plan(), "/subscriptions": { id: "sub_NEW", plan_id: "plan_M", status: "created" } });
    const r = await createRazorpaySubscription(rz, "month", UID, f);
    expect(r).toEqual({ id: "sub_NEW", amountMinor: 14900, currency: "INR" });
    const body = JSON.parse(String(f.calls.find((c) => c.url.endsWith("/subscriptions"))!.init!.body));
    expect(body).toMatchObject({ plan_id: "plan_M", total_count: 120, notes: { user_id: UID } });
    expect(JSON.stringify(body)).not.toMatch(/amount/);
  });
  it("provider failures become a plain error with no provider text", async () => {
    const e = (await createRazorpaySubscription(rz, "month", UID, router({ "/plans/plan_M": () => new Response("RAW SECRET BODY", { status: 500 }) })).catch((x) => x)) as BillingError;
    expect(e).toBeInstanceOf(BillingError);
    expect(e.code).toBe("provider_error");
    expect(e.message).not.toMatch(/RAW|SECRET/);
  });
});

describe("Razorpay: checkout signature and verification", () => {
  it("accepts only the correct signature over payment_id|subscription_id", () => {
    expect(verifyCheckoutSignature("pay_1", "sub_1", sign("pay_1", "sub_1"), SECRET)).toBe(true);
    expect(verifyCheckoutSignature("pay_2", "sub_1", sign("pay_1", "sub_1"), SECRET)).toBe(false); // another payment
    expect(verifyCheckoutSignature("pay_1", "sub_2", sign("pay_1", "sub_1"), SECRET)).toBe(false); // another subscription
    expect(verifyCheckoutSignature("pay_1", "sub_1", sign("pay_1", "sub_1", "wrong"), SECRET)).toBe(false);
    expect(verifyCheckoutSignature("pay_1", "sub_1", "", SECRET)).toBe(false);
    expect(verifyCheckoutSignature("pay_1", "sub_1", "short", SECRET)).toBe(false);
  });

  const expectOk = { userId: UID, interval: "month" as const, amountMinor: 14900, currency: "INR" };
  const input = (over = {}) => ({ paymentId: "pay_1", subscriptionId: "sub_1", signature: sign("pay_1", "sub_1"), ...over });
  const sub = (over = {}) => ({ id: "sub_1", plan_id: "plan_M", status: "active", customer_id: "cust_1", current_start: 1_800_000_000, current_end: 1_802_592_000, notes: { user_id: UID }, ...over });
  const pay = (over = {}) => ({ id: "pay_1", amount: 14900, currency: "INR", status: "captured", created_at: 1_800_000_000, ...over });
  const f = (s = sub(), p = pay()) => router({ "/subscriptions/sub_1": s, "/payments/pay_1": p });

  it("a verified, correctly priced, captured payment activates the plan", async () => {
    const ev = await confirmRazorpayCheckout(rz, input(), expectOk, f());
    expect(ev).toMatchObject({ provider: "razorpay", eventId: "verify:pay_1", userId: UID });
    expect(ev.subscription).toMatchObject({ provider_subscription_id: "sub_1", status: "active", current_period_end: new Date(1_802_592_000 * 1000).toISOString() });
    expect(firstPayment(ev.payment)).toMatchObject({ provider_payment_id: "pay_1", amount_minor: 14900, currency: "INR", status: "captured" });
  });
  it("a bad signature is rejected before the provider is even asked", async () => {
    const fetcher = f();
    expect(await code(confirmRazorpayCheckout(rz, input({ signature: sign("pay_1", "sub_1", "forged") }), expectOk, fetcher))).toBe("invalid_signature");
    expect(fetcher.calls).toHaveLength(0);
  });
  it("a payment of the wrong amount or currency never activates anything", async () => {
    expect(await code(confirmRazorpayCheckout(rz, input(), expectOk, f(sub(), pay({ amount: 100 }))))).toBe("amount_mismatch");
    expect(await code(confirmRazorpayCheckout(rz, input(), expectOk, f(sub(), pay({ currency: "USD" }))))).toBe("amount_mismatch");
  });
  it("a subscription belonging to someone else, or without an owner, is refused", async () => {
    expect(await code(confirmRazorpayCheckout(rz, input(), expectOk, f(sub({ notes: { user_id: OTHER } }))))).toBe("owner_mismatch");
    expect(await code(confirmRazorpayCheckout(rz, input(), expectOk, f(sub({ notes: [] }))))).toBe("owner_mismatch");
  });
  it("a different plan than the configured one is refused", async () => {
    expect(await code(confirmRazorpayCheckout(rz, input(), expectOk, f(sub({ plan_id: "plan_CHEAP" }))))).toBe("plan_mismatch");
  });
  it("an authorised-but-not-captured payment, or a subscription not yet active, does not grant access", async () => {
    expect((await confirmRazorpayCheckout(rz, input(), expectOk, f(sub(), pay({ status: "authorized" })))).subscription?.status).toBe("pending");
    expect((await confirmRazorpayCheckout(rz, input(), expectOk, f(sub({ status: "authenticated", current_end: null })))).subscription?.status).toBe("pending");
    expect((await confirmRazorpayCheckout(rz, input(), expectOk, f(sub({ current_end: null })))).subscription?.status).toBe("pending"); // no paid-through date
  });
  it("a failed payment is recorded as failed and grants nothing", async () => {
    const ev = await confirmRazorpayCheckout(rz, input(), expectOk, f(sub({ status: "created", current_end: null }), pay({ status: "failed" })));
    expect(firstPayment(ev.payment)?.status).toBe("failed");
    expect(ev.subscription?.status).toBe("pending");
  });
});

describe("Razorpay: webhook event mapping", () => {
  const ev = (event: string, over: Record<string, unknown> = {}) => ({ event, created_at: 1_800_000_000, payload: { subscription: { entity: { id: "sub_1", status: "active", customer_id: "c1", current_start: 1_800_000_000, current_end: 1_802_592_000, notes: { user_id: UID }, ...over } } } });
  it.each([
    ["subscription.authenticated", "pending"],
    ["subscription.activated", "active"],
    ["subscription.charged", "active"],
    ["subscription.resumed", "active"],
    ["subscription.pending", "past_due"],
    ["subscription.halted", "past_due"],
    ["subscription.paused", "past_due"],
    ["subscription.cancelled", "canceled"],
    ["subscription.completed", "expired"],
  ])("%s -> %s", (event, status) => {
    const m = razorpayEventToBilling(ev(event), "evt_1")!;
    expect(m).toMatchObject({ provider: "razorpay", eventId: "evt_1", eventType: event, userId: UID });
    expect(m.subscription).toMatchObject({ provider_subscription_id: "sub_1", status });
    expect(m.eventAt.toISOString()).toBe(new Date(1_800_000_000 * 1000).toISOString()); // the provider's time, not ours
  });
  it("subscription.charged carries the payment into the ledger", () => {
    const body = { ...ev("subscription.charged"), payload: { ...ev("subscription.charged").payload, payment: { entity: { id: "pay_9", amount: 14900, currency: "INR", status: "captured", created_at: 1_800_000_100 } } } };
    expect(firstPayment(razorpayEventToBilling(body, "e")!.payment)).toMatchObject({ provider_payment_id: "pay_9", provider_subscription_id: "sub_1", amount_minor: 14900, status: "captured" });
  });
  it("a failed renewal writes one failed ledger row, with the same id for Razorpay's retries of that renewal", () => {
    const pending = razorpayEventToBilling(ev("subscription.pending", { paid_count: 3 }), "e1")!;
    const halted = razorpayEventToBilling(ev("subscription.halted", { paid_count: 3 }), "e2")!;
    expect(pending.payment).toEqual({ provider_payment_id: "renewal_failed:sub_1:3", provider_subscription_id: "sub_1", status: "failed", failure_reason: "Renewal payment failed" });
    expect(firstPayment(halted.payment)?.provider_payment_id).toBe("renewal_failed:sub_1:3"); // same renewal, one row
    expect(pending.payment).not.toHaveProperty("amount_minor"); // the database fills in the subscription's own price
    expect(firstPayment(razorpayEventToBilling(ev("subscription.halted", { paid_count: 4 }), "e3")!.payment)?.provider_payment_id).toBe("renewal_failed:sub_1:4"); // the next renewal is a different row
    expect(razorpayEventToBilling(ev("subscription.activated"), "e")!.payment).toBeNull();
  });
  it("reconcile re-reads a subscription for the daily repair job, and refuses one that is not this person's", async () => {
    const row = { provider_subscription_id: "sub_1", user_id: UID };
    const f = router({ "/subscriptions/sub_1": { id: "sub_1", plan_id: "plan_M", status: "active", current_start: 1_800_000_000, current_end: 1_802_592_000, notes: { user_id: UID } } });
    expect((await reconcileRazorpaySubscription(rz, row, "reconcile:x", f))!.subscription).toMatchObject({ status: "active", current_period_end: new Date(1_802_592_000 * 1000).toISOString() });
    expect(await reconcileRazorpaySubscription(rz, { ...row, user_id: OTHER }, "reconcile:x", f)).toBeNull();
    expect(await reconcileRazorpaySubscription(rz, { ...row, user_id: null }, "reconcile:x", f)).toBeNull();
  });
  it("a cancellation records when it happened", () => {
    expect(razorpayEventToBilling(ev("subscription.cancelled"), "e")!.subscription?.canceled_at).toBeTruthy();
  });
  it("payment and refund events move only an existing payment row, found by payment id", () => {
    const p = (event: string, entity: object) => razorpayEventToBilling({ event, created_at: 1_800_000_000, payload: { payment: { entity: { id: "pay_1", amount: 14900, currency: "INR", ...entity } } } }, "e")!;
    expect(p("payment.failed", { status: "failed", error_description: "Card declined" })).toMatchObject({ subscription: null, userId: null, payment: { status: "failed", failure_reason: "Card declined" } });
    expect(p("payment.failed", { status: "failed", subscription_id: "sub_77" }).payment).toMatchObject({ provider_subscription_id: "sub_77" }); // linked when Razorpay says which subscription
    expect(firstPayment(p("payment.captured", { status: "captured" }).payment)?.status).toBe("captured");
    expect(firstPayment(p("refund.processed", { refund_status: "full" }).payment)?.status).toBe("refunded");
    expect(firstPayment(p("refund.created", { refund_status: "partial" }).payment)?.status).toBe("partially_refunded");
    expect(p("refund.created", {})).toBeNull();
  });
  it("ignores events that change nothing, malformed events, and unknown statuses", () => {
    expect(razorpayEventToBilling({ event: "order.paid", payload: {} }, "e")).toBeNull();
    expect(razorpayEventToBilling({ event: "subscription.activated", payload: {} }, "e")).toBeNull();
    expect(razorpayEventToBilling(ev("subscription.updated", { status: "weird" }), "e")).toBeNull();
    expect(razorpayEventToBilling({}, "e")).toBeNull();
    expect(razorpayEventToBilling(null, "e")).toBeNull();
  });
  it("a missing or malformed user note yields no user (the database then uses the owner on record)", () => {
    expect(razorpayEventToBilling(ev("subscription.activated", { notes: {} }), "e")!.userId).toBeNull();
    expect(razorpayEventToBilling(ev("subscription.activated", { notes: { user_id: "not-a-uuid" } }), "e")!.userId).toBeNull();
  });
  it("covers every provider status", () => {
    expect(["created", "authenticated", "active", "pending", "halted", "paused", "cancelled", "completed", "expired", "x"].map(subscriptionStatus)).toEqual(["pending", "pending", "active", "past_due", "past_due", "past_due", "canceled", "expired", "expired", null]);
  });
});

describe("PayPal: plan, state and verification", () => {
  const plan = (over = {}) => ({ id: "P-MONTH", status: "ACTIVE", billing_cycles: [{ tenure_type: "REGULAR", frequency: { interval_unit: "MONTH", interval_count: 1 }, pricing_scheme: { fixed_price: { value: "2.00", currency_code: "USD" } } }], ...over });
  const tok = { "/oauth2/token": { access_token: "TOKEN", expires_in: 300 } };

  it("reads the price from PayPal: amount and currency are the plan's, not the browser's", async () => {
    expect(await readPlanPrice(pp, "month", router({ ...tok, "/billing/plans/P-MONTH": plan() }))).toEqual({ planId: "P-MONTH", amountMinor: 200, currency: "USD" });
  });
  it.each([
    ["an inactive plan", plan({ status: "INACTIVE" })],
    ["a yearly plan configured as monthly", plan({ billing_cycles: [{ tenure_type: "REGULAR", frequency: { interval_unit: "YEAR", interval_count: 1 }, pricing_scheme: { fixed_price: { value: "20.00", currency_code: "USD" } } }] })],
    ["a plan with no price", plan({ billing_cycles: [{ tenure_type: "REGULAR", frequency: { interval_unit: "MONTH", interval_count: 1 } }] })],
    ["a free trial plus regular cycles", plan({ billing_cycles: [{ tenure_type: "REGULAR", frequency: { interval_unit: "MONTH", interval_count: 1 }, pricing_scheme: { fixed_price: { value: "2.00", currency_code: "USD" } } }, { tenure_type: "REGULAR", frequency: { interval_unit: "MONTH", interval_count: 1 }, pricing_scheme: { fixed_price: { value: "9.00", currency_code: "USD" } } }] })],
  ])("refuses %s", async (_n, p) => {
    expect(await code(readPlanPrice(pp, "month", router({ ...tok, "/billing/plans/P-MONTH": p })))).toBe("plan_mismatch");
  });

  it("creates a subscription carrying the user id and returns only a PayPal approval address", async () => {
    const f = router({ ...tok, "/billing/plans/P-MONTH": plan(), "/billing/subscriptions": { id: "I-ABC", status: "APPROVAL_PENDING", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=X" }] } });
    const r = await createPaypalSubscription(pp, "month", UID, { returnUrl: "https://x/return", cancelUrl: "https://x/cancel", brand: "FinTrack" }, f);
    expect(r).toMatchObject({ id: "I-ABC", amountMinor: 200, currency: "USD", approveUrl: expect.stringContaining("paypal.com") });
    const body = JSON.parse(String(f.calls.find((c) => c.url.endsWith("/billing/subscriptions"))!.init!.body));
    expect(body).toMatchObject({ plan_id: "P-MONTH", custom_id: UID });
  });
  it("refuses an approval link that is not on paypal.com", async () => {
    const f = router({ ...tok, "/billing/plans/P-MONTH": plan(), "/billing/subscriptions": { id: "I-ABC", links: [{ rel: "approve", href: "https://evil.example/paypal.com/" }] } });
    expect(await code(createPaypalSubscription(pp, "month", UID, { returnUrl: "r", cancelUrl: "c", brand: "b" }, f))).toBe("provider_error");
  });

  const expectOk = { userId: UID, planId: "P-MONTH", amountMinor: 200, currency: "USD" };
  const live = (over: Partial<PpSubscription> = {}): PpSubscription => ({ id: "I-ABC", plan_id: "P-MONTH", status: "ACTIVE", custom_id: UID, start_time: "2026-11-01T00:00:00Z", subscriber: { payer_id: "PAYER" }, billing_info: { next_billing_time: "2026-12-01T00:00:00Z" }, ...over });
  const tx = (over: Partial<PpTransaction> = {}): PpTransaction => ({ id: "SALE-1", status: "COMPLETED", time: "2026-11-01T00:00:05Z", amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "2.00" } }, ...over });
  const state = (s: PpSubscription, txs: PpTransaction[] = [tx()]) => paypalStateToBilling(s, expectOk, { eventId: "e", eventType: "t" }, new Date("2026-11-02T00:00:00Z"), txs);

  it("an active, paid subscription for this person, plan and price grants the plan, and the ledger uses PayPal's real transaction id", () => {
    const ev = state(live());
    expect(ev.subscription).toMatchObject({ status: "active", current_period_end: "2026-12-01T00:00:00Z", provider_customer_id: "PAYER" });
    expect(allPayments(ev.payment)).toEqual([{ provider_payment_id: "SALE-1", provider_subscription_id: "I-ABC", amount_minor: 200, currency: "USD", status: "captured", failure_reason: null, paid_at: "2026-11-01T00:00:05Z" }]);
  });
  it("approval without a recorded payment or a renewal date does not grant access", () => {
    expect(state(live(), []).subscription?.status).toBe("pending");
    expect(state(live({ billing_info: {} })).subscription?.status).toBe("pending");
    expect(state(live({ status: "APPROVAL_PENDING" })).subscription?.status).toBe("pending");
    expect(state(live(), [tx({ status: "DECLINED" })]).subscription?.status).toBe("pending"); // a declined payment is not a payment
  });
  it("another person's subscription, another plan, or a different amount is refused", () => {
    expect(() => state(live({ custom_id: OTHER }))).toThrow(BillingError);
    expect(() => state(live({ custom_id: null }))).toThrow(BillingError);
    expect(() => state(live({ plan_id: "P-CHEAP" }))).toThrow(BillingError);
    expect(() => state(live(), [tx({ amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "0.01" } } })])).toThrow(BillingError);
    expect(() => state(live(), [tx({ amount_with_breakdown: { gross_amount: { currency_code: "EUR", value: "2.00" } } })])).toThrow(BillingError);
  });
  it("refunds are carried on the payment they belong to: full, partial, and declined renewals", () => {
    const ev = state(live({ status: "SUSPENDED" }), [
      tx({ id: "S1", status: "REFUNDED", time: "2026-09-01T00:00:00Z" }),
      tx({ id: "S2", status: "PARTIALLY_REFUNDED", time: "2026-10-01T00:00:00Z" }),
      tx({ id: "S3", status: "DECLINED", time: "2026-11-01T00:00:00Z" }),
      tx({ id: "S4", status: "WEIRD" }),
    ]);
    expect(allPayments(ev.payment).map((p) => `${p.provider_payment_id}:${p.status}:${p.paid_at ?? "-"}`)).toEqual(["S1:refunded:2026-09-01T00:00:00Z", "S2:partially_refunded:2026-10-01T00:00:00Z", "S3:failed:-"]);
    expect(allPayments(ev.payment)[2].failure_reason).toBe("Payment declined");
    expect(ev.subscription?.status).toBe("past_due");
  });
  it("maps every lifecycle status, including failed renewals and cancellation", () => {
    expect(["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED", "?"].map(paypalStatus)).toEqual(["pending", "pending", "active", "past_due", "canceled", "expired", null]);
    expect(state(live({ status: "SUSPENDED" })).subscription?.status).toBe("past_due");
    const c = state(live({ status: "CANCELLED" }));
    expect(c.subscription?.status).toBe("canceled");
    expect(c.subscription?.canceled_at).toBeTruthy();
  });
  it("lists a subscription's transactions from PayPal for a bounded window", async () => {
    const f = router({ ...tok, "/billing/subscriptions/I-ABC/transactions": { transactions: [tx()] } });
    expect(await listPaypalTransactions(pp, "I-ABC", "2026-10-01T00:00:00.000Z", new Date("2026-11-02T00:00:00Z"), f)).toHaveLength(1);
    expect(f.calls.at(-1)!.url).toMatch(/start_time=2026-10-01.*end_time=2026-11-02/);
  });
  it("sync reads the subscription and its transactions together and refuses a subscription whose owner is gone", async () => {
    const row = { provider_subscription_id: "I-ABC", user_id: UID, interval: "month" as const, amount_minor: 200, currency: "USD", created_at: "2026-11-01T00:00:00Z" };
    const f = router({ ...tok, "/billing/subscriptions/I-ABC/transactions": { transactions: [tx({ id: "S9", status: "REFUNDED" })] }, "/billing/subscriptions/I-ABC": live() });
    const ev = await syncPaypalSubscription(pp, row, { eventId: "e", eventType: "t" }, f, new Date("2026-11-02T00:00:00Z"));
    expect(allPayments(ev.payment)[0]).toMatchObject({ provider_payment_id: "S9", status: "refunded" });
    expect(await code(syncPaypalSubscription(pp, { ...row, user_id: null }, { eventId: "e", eventType: "t" }, f))).toBe("owner_mismatch");
  });
  it("finds the subscription an event is about", () => {
    expect(paypalEventSubscriptionId({ event_type: "BILLING.SUBSCRIPTION.ACTIVATED", resource: { id: "I-1" } })).toBe("I-1");
    expect(paypalEventSubscriptionId({ event_type: "PAYMENT.SALE.COMPLETED", resource: { billing_agreement_id: "I-2" } })).toBe("I-2");
    expect(paypalEventSubscriptionId({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "x" } })).toBeNull();
    expect(paypalEventSubscriptionId({ event_type: "PAYMENT.SALE.REFUNDED", resource: { sale_id: "S1" } })).toBeNull(); // refunds name the sale, below
  });
  it("finds the original sale a refund or reversal is about", () => {
    expect(paypalEventSaleId({ event_type: "PAYMENT.SALE.REFUNDED", resource: { id: "REFUND-1", sale_id: "SALE-1" } })).toBe("SALE-1");
    expect(paypalEventSaleId({ event_type: "PAYMENT.SALE.REVERSED", resource: { sale_id: "SALE-2" } })).toBe("SALE-2");
    expect(paypalEventSaleId({ event_type: "PAYMENT.SALE.COMPLETED", resource: { id: "x" } })).toBeNull();
  });

  describe("webhook signature", () => {
    const headers = (over: Record<string, string> = {}) => new Headers({ "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT", "paypal-transmission-id": "T1", "paypal-transmission-sig": "SIG", "paypal-transmission-time": "2026-11-01T00:00:00Z", ...over });
    it("is verified by PayPal itself, with our webhook id", async () => {
      const f = router({ ...tok, "/verify-webhook-signature": { verification_status: "SUCCESS" } });
      expect(await verifyPaypalWebhook(pp, headers(), { id: "WH-EVT" }, f)).toBe(true);
      const sent = JSON.parse(String(f.calls.find((c) => c.url.includes("verify-webhook-signature"))!.init!.body));
      expect(sent).toMatchObject({ webhook_id: "WH-1", transmission_id: "T1", webhook_event: { id: "WH-EVT" } });
    });
    it("a FAILURE verdict, an error, missing headers or no webhook id all mean not verified", async () => {
      expect(await verifyPaypalWebhook(pp, headers(), {}, router({ ...tok, "/verify-webhook-signature": { verification_status: "FAILURE" } }))).toBe(false);
      expect(await verifyPaypalWebhook(pp, headers(), {}, router({ ...tok, "/verify-webhook-signature": () => json({}, 500) }))).toBe(false);
      expect(await verifyPaypalWebhook(pp, new Headers(), {}, router({}))).toBe(false);
      expect(await verifyPaypalWebhook({ ...pp, webhookId: undefined }, headers(), {}, router({}))).toBe(false);
    });
    it("an attacker-supplied certificate address is refused without calling PayPal", async () => {
      const f = router({ ...tok, "/verify-webhook-signature": { verification_status: "SUCCESS" } });
      expect(await verifyPaypalWebhook(pp, headers({ "paypal-cert-url": "https://evil.example/certs/CERT" }), {}, f)).toBe(false);
      expect(f.calls).toHaveLength(0);
    });
  });
});

describe("webhook and checkout routes", () => {
  const st = vi.hoisted(() => ({
    rpc: [] as { fn: string; args: Record<string, unknown> }[],
    rpcResult: "applied" as string,
    rpcError: false,
    adminOn: true,
    user: null as { id: string; email: string } | null,
    tables: {} as Record<string, unknown>,
    recentCheckouts: 0,
  }));
  vi.mock("@/server/admin", () => {
    const query = (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ["select", "eq", "in", "lt", "gte", "neq", "not", "order", "limit", "update", "insert"]) chain[m] = self;
      chain.maybeSingle = async () => ({ data: st.tables[table] ?? null });
      chain.then = (res: (v: unknown) => unknown) => res(table === "billing_audit" ? { count: st.recentCheckouts, data: [] } : { data: (st.tables[table + ":list"] as unknown[]) ?? [], error: null });
      return chain;
    };
    return { createAdminClient: () => (st.adminOn ? { rpc: async (fn: string, args: Record<string, unknown>) => (st.rpc.push({ fn, args }), st.rpcError ? { data: null, error: { message: "db" } } : { data: fn === "billing_sweep_expired" ? 2 : st.rpcResult, error: null }), from: query } : null) };
  });
  vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: st.user } }) } }) }));
  vi.mock("@/server/site-url", () => ({ siteUrl: async () => "http://127.0.0.1:3100" }));

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(`http://127.0.0.1:3100${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { host: "127.0.0.1:3100", ...headers } });
  const SIGN = (b: string, secret: string) => createHmac("sha256", secret).update(b).digest("hex");

  beforeEach(() => {
    st.rpc.length = 0;
    st.rpcResult = "applied";
    st.rpcError = false;
    st.adminOn = true;
    st.user = { id: UID, email: "a@b.c" };
    st.tables = {};
    st.recentCheckouts = 0;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_route");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc");
    vi.stubEnv("RAZORPAY_KEY_SECRET", SECRET);
    vi.stubEnv("RAZORPAY_PLAN_ID_ONE_MONTHLY", "plan_M");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3100");
  });

  describe("Razorpay webhook", () => {
    const body = JSON.stringify({ event: "subscription.activated", created_at: 1_800_000_000, payload: { subscription: { entity: { id: "sub_9", status: "active", current_end: 1_802_592_000, notes: { user_id: UID } } } } });
    const call = async (b: string, headers: Record<string, string>) => (await import("@/app/api/webhooks/razorpay/route")).POST(post("/api/webhooks/razorpay", b, headers));

    it("answers 503 and changes nothing until credentials exist", async () => {
      vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
      expect((await call(body, { "x-razorpay-signature": SIGN(body, "whsec_route"), "x-razorpay-event-id": "e1" })).status).toBe(503);
      st.adminOn = false;
      vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_route");
      expect((await call(body, { "x-razorpay-signature": SIGN(body, "whsec_route"), "x-razorpay-event-id": "e1" })).status).toBe(503);
      expect(st.rpc).toHaveLength(0);
    });
    it("rejects a forged or missing signature before touching the database", async () => {
      expect((await call(body, { "x-razorpay-signature": "bad", "x-razorpay-event-id": "e1" })).status).toBe(400);
      expect((await call(body, { "x-razorpay-signature": SIGN(body, "other-secret"), "x-razorpay-event-id": "e1" })).status).toBe(400);
      expect((await call(body, { "x-razorpay-event-id": "e1" })).status).toBe(400);
      expect(st.rpc).toHaveLength(0);
    });
    it("needs an event id", async () => {
      expect((await call(body, { "x-razorpay-signature": SIGN(body, "whsec_route") })).status).toBe(400);
    });
    it("a valid event is recorded once, through the atomic database function, with the provider's own time", async () => {
      const res = await call(body, { "x-razorpay-signature": SIGN(body, "whsec_route"), "x-razorpay-event-id": "evt_1" });
      expect(res.status).toBe(200);
      expect(st.rpc).toHaveLength(1);
      expect(st.rpc[0].fn).toBe("billing_apply_event");
      expect(st.rpc[0].args).toMatchObject({ p_provider: "razorpay", p_event_id: "evt_1", p_event_type: "subscription.activated", p_event_at: new Date(1_800_000_000 * 1000).toISOString(), p_user: UID });
      expect(st.rpc[0].args.p_subscription).toMatchObject({ provider_subscription_id: "sub_9", status: "active" });
    });
    it("a redelivered event is acknowledged as a duplicate", async () => {
      st.rpcResult = "duplicate";
      expect(await (await call(body, { "x-razorpay-signature": SIGN(body, "whsec_route"), "x-razorpay-event-id": "evt_1" })).json()).toEqual({ ok: true, duplicate: true });
    });
    it("a database failure answers 500 so Razorpay retries", async () => {
      st.rpcError = true;
      expect((await call(body, { "x-razorpay-signature": SIGN(body, "whsec_route"), "x-razorpay-event-id": "evt_1" })).status).toBe(500);
    });
    it("events that change nothing are acknowledged without a database call", async () => {
      const other = JSON.stringify({ event: "order.paid", payload: {} });
      expect(await (await call(other, { "x-razorpay-signature": SIGN(other, "whsec_route"), "x-razorpay-event-id": "evt_2" })).json()).toEqual({ ok: true, ignored: true });
      expect(st.rpc).toHaveLength(0);
    });
  });

  describe("PayPal webhook", () => {
    const evt = JSON.stringify({ id: "WH-EVT-1", event_type: "BILLING.SUBSCRIPTION.CANCELLED", resource: { id: "I-ABC" } });
    const hdrs = { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/C", "paypal-transmission-id": "T", "paypal-transmission-sig": "S", "paypal-transmission-time": "2026-11-01T00:00:00Z" };
    const call = async () => (await import("@/app/api/webhooks/paypal/route")).POST(post("/api/webhooks/paypal", evt, hdrs));
    beforeEach(() => {
      vi.stubEnv("PAYPAL_CLIENT_ID", "cid");
      vi.stubEnv("PAYPAL_CLIENT_SECRET", "csecret");
      vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH-1");
      vi.stubEnv("PAYPAL_PLAN_ID_ONE_MONTHLY", "P-MONTH");
    });
    it("answers 503 without a webhook id", async () => {
      vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
      expect((await call()).status).toBe(503);
    });
    it("rejects a delivery PayPal does not verify, touching nothing", async () => {
      vi.stubGlobal("fetch", router({ "/oauth2/token": { access_token: "T", expires_in: 300 }, "/verify-webhook-signature": { verification_status: "FAILURE" } }));
      expect((await call()).status).toBe(400);
      expect(st.rpc).toHaveLength(0);
    });
    it("a verified event for a subscription we never created is stored and changes nothing else", async () => {
      vi.stubGlobal("fetch", router({ "/oauth2/token": { access_token: "T", expires_in: 300 }, "/verify-webhook-signature": { verification_status: "SUCCESS" } }));
      expect((await call()).status).toBe(200);
      expect(st.rpc).toHaveLength(1);
      expect(st.rpc[0].args).toMatchObject({ p_event_id: "WH-EVT-1", p_user: null, p_subscription: null, p_payment: null });
    });
    it("a verified event for one of ours records PayPal's current state, not the event's claim", async () => {
      st.tables.billing_subscriptions = { id: "r1", user_id: UID, provider: "paypal", provider_subscription_id: "I-ABC", interval: "month", amount_minor: 200, currency: "USD", status: "active", current_period_end: null, cancel_at_period_end: false, created_at: "2026-11-01T00:00:00Z" };
      vi.stubGlobal("fetch", router({ "/oauth2/token": { access_token: "T", expires_in: 300 }, "/verify-webhook-signature": { verification_status: "SUCCESS" }, "/billing/subscriptions/I-ABC/transactions": { transactions: [] }, "/billing/subscriptions/I-ABC": { id: "I-ABC", plan_id: "P-MONTH", status: "CANCELLED", custom_id: UID } }));
      expect((await call()).status).toBe(200);
      expect(st.rpc[0].args.p_subscription).toMatchObject({ provider_subscription_id: "I-ABC", status: "canceled" });
    });
    it("a refund names only the sale: it is matched through the ledger and recorded on the original payment", async () => {
      const refundEvt = JSON.stringify({ id: "WH-REFUND-1", event_type: "PAYMENT.SALE.REFUNDED", resource: { id: "REFUND-1", sale_id: "SALE-1" } });
      st.tables.billing_payments = { subscription_id: "r1" };
      st.tables.billing_subscriptions = { id: "r1", user_id: UID, provider: "paypal", provider_subscription_id: "I-ABC", interval: "month", amount_minor: 200, currency: "USD", status: "active", current_period_end: null, cancel_at_period_end: false, created_at: "2026-11-01T00:00:00Z" };
      vi.stubGlobal("fetch", router({ "/oauth2/token": { access_token: "T", expires_in: 300 }, "/verify-webhook-signature": { verification_status: "SUCCESS" }, "/billing/subscriptions/I-ABC/transactions": { transactions: [{ id: "SALE-1", status: "REFUNDED", time: "2026-11-01T00:00:05Z", amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "2.00" } } }] }, "/billing/subscriptions/I-ABC": { id: "I-ABC", plan_id: "P-MONTH", status: "ACTIVE", custom_id: UID, billing_info: { next_billing_time: "2026-12-01T00:00:00Z" } } }));
      const res = await (await import("@/app/api/webhooks/paypal/route")).POST(post("/api/webhooks/paypal", refundEvt, hdrs));
      expect(res.status).toBe(200);
      expect(st.rpc).toHaveLength(1);
      expect(st.rpc[0].args.p_event_id).toBe("WH-REFUND-1");
      expect(st.rpc[0].args.p_payment).toEqual([expect.objectContaining({ provider_payment_id: "SALE-1", status: "refunded" })]);
    });
    it("a refund for a payment not in the ledger yet is stored and left for the daily reconcile", async () => {
      const refundEvt = JSON.stringify({ id: "WH-REFUND-2", event_type: "PAYMENT.SALE.REFUNDED", resource: { id: "REFUND-2", sale_id: "SALE-UNKNOWN" } });
      vi.stubGlobal("fetch", router({ "/oauth2/token": { access_token: "T", expires_in: 300 }, "/verify-webhook-signature": { verification_status: "SUCCESS" } }));
      expect((await (await import("@/app/api/webhooks/paypal/route")).POST(post("/api/webhooks/paypal", refundEvt, hdrs))).status).toBe(200);
      expect(st.rpc[0].args).toMatchObject({ p_event_id: "WH-REFUND-2", p_subscription: null, p_payment: null });
    });
    it("an inconsistent real subscription is acknowledged, audited and never applied", async () => {
      st.tables.billing_subscriptions = { id: "r1", user_id: UID, provider: "paypal", provider_subscription_id: "I-ABC", interval: "month", amount_minor: 200, currency: "USD", status: "active", current_period_end: null, cancel_at_period_end: false, created_at: "2026-11-01T00:00:00Z" };
      vi.stubGlobal("fetch", router({ "/oauth2/token": { access_token: "T", expires_in: 300 }, "/verify-webhook-signature": { verification_status: "SUCCESS" }, "/billing/subscriptions/I-ABC/transactions": { transactions: [] }, "/billing/subscriptions/I-ABC": { id: "I-ABC", plan_id: "P-OTHER", status: "ACTIVE", custom_id: UID } }));
      const res = await call();
      expect(await res.json()).toMatchObject({ ok: true, rejected: "plan_mismatch" });
      expect(st.rpc).toHaveLength(0);
    });
  });

  describe("daily billing cron", () => {
    const run = async (auth?: string) => (await import("@/app/api/cron/billing/route")).GET(new NextRequest("http://127.0.0.1:3100/api/cron/billing", { headers: auth ? { authorization: auth } : {} }));
    beforeEach(() => vi.stubEnv("CRON_SECRET", "cron-secret-0123456789"));
    it("is closed without a configured secret, and to anyone who does not present it", async () => {
      vi.stubEnv("CRON_SECRET", "");
      expect((await run("Bearer cron-secret-0123456789")).status).toBe(503);
      vi.stubEnv("CRON_SECRET", "short");
      expect((await run("Bearer short")).status).toBe(503);
      vi.stubEnv("CRON_SECRET", "cron-secret-0123456789");
      expect((await run()).status).toBe(401);
      expect((await run("Bearer wrong-secret-0123456789")).status).toBe(401);
      expect(st.rpc).toHaveLength(0);
    });
    it("sweeps expired subscriptions and re-reads each live one from its provider", async () => {
      st.tables["billing_subscriptions:list"] = [{ id: "r1", user_id: UID, provider: "paypal", provider_subscription_id: "I-ABC", interval: "month", amount_minor: 200, currency: "USD", status: "active", current_period_end: null, cancel_at_period_end: false, created_at: "2026-11-01T00:00:00Z" }];
      vi.stubEnv("PAYPAL_CLIENT_ID", "cid");
      vi.stubEnv("PAYPAL_CLIENT_SECRET", "csecret");
      vi.stubEnv("PAYPAL_PLAN_ID_ONE_MONTHLY", "P-MONTH");
      vi.stubGlobal("fetch", router({ "/oauth2/token": { access_token: "T", expires_in: 300 }, "/billing/subscriptions/I-ABC/transactions": { transactions: [{ id: "S1", status: "COMPLETED", time: "2026-11-01T00:00:05Z", amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "2.00" } } }] }, "/billing/subscriptions/I-ABC": { id: "I-ABC", plan_id: "P-MONTH", status: "ACTIVE", custom_id: UID, billing_info: { next_billing_time: "2026-12-01T00:00:00Z" } } }));
      const res = await run("Bearer cron-secret-0123456789");
      expect(await res.json()).toEqual({ swept: 2, checked: 1, updated: 1, failed: 0 });
      expect(st.rpc.map((r) => r.fn)).toEqual(["billing_sweep_expired", "billing_apply_event"]);
      expect(String(st.rpc[1].args.p_event_id)).toMatch(/^reconcile:I-ABC:\d{4}-\d{2}-\d{2}$/);
    });
    it("a provider failure for one subscription is counted, not thrown, and does not stop the run", async () => {
      st.tables["billing_subscriptions:list"] = [{ id: "r1", user_id: UID, provider: "paypal", provider_subscription_id: "I-ABC", interval: "month", amount_minor: 200, currency: "USD", status: "active", current_period_end: null, cancel_at_period_end: false, created_at: "2026-11-01T00:00:00Z" }];
      vi.stubEnv("PAYPAL_CLIENT_ID", "cid");
      vi.stubEnv("PAYPAL_CLIENT_SECRET", "csecret");
      vi.stubEnv("PAYPAL_PLAN_ID_ONE_MONTHLY", "P-MONTH");
      vi.stubGlobal("fetch", router({ "/oauth2/token": { access_token: "T", expires_in: 300 }, "/billing/subscriptions/I-ABC": () => new Response("SECRET PROVIDER TEXT", { status: 500 }) }));
      const res = await run("Bearer cron-secret-0123456789");
      expect(await res.json()).toMatchObject({ failed: 1, updated: 0 });
    });
  });

  describe("checkout routes", () => {
    const origin = { origin: "http://127.0.0.1:3100" };
    const checkout = async (b: unknown, headers: Record<string, string> = origin) => (await import("@/app/api/billing/razorpay/checkout/route")).POST(post("/api/billing/razorpay/checkout", b, headers));

    it("refuses a request from another site", async () => {
      expect((await checkout({ interval: "month" }, { origin: "https://evil.example" })).status).toBe(403);
      expect((await checkout({ interval: "month" }, {})).status).toBe(403);
    });
    it("requires sign-in", async () => {
      st.user = null;
      expect((await checkout({ interval: "month" })).status).toBe(401);
    });
    it("rejects an unknown period and ignores any price the browser sends", async () => {
      expect((await checkout({ interval: "decade" })).status).toBe(400);
      expect((await checkout({ interval: "week", amount: 1 })).status).toBe(400);
    });
    it("is unavailable until payments are configured", async () => {
      vi.stubEnv("RAZORPAY_KEY_ID", "");
      expect((await checkout({ interval: "month" })).status).toBe(503);
    });
    it("limits how many checkouts one person can start in an hour", async () => {
      st.recentCheckouts = 5;
      const res = await checkout({ interval: "month" });
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe("rate_limited");
    });
    it("refuses a second subscription while one is running", async () => {
      st.tables["billing_subscriptions:list"] = [{ status: "active", current_period_end: "2099-01-01T00:00:00Z" }];
      expect((await checkout({ interval: "month" })).status).toBe(409);
    });
    it("hands the browser only the public key and the subscription id", async () => {
      vi.stubGlobal("fetch", router({ "/plans/plan_M": { id: "plan_M", period: "monthly", interval: 1, item: { amount: 14900, currency: "INR" } }, "/subscriptions": { id: "sub_NEW", plan_id: "plan_M", status: "created" } }));
      const res = await checkout({ interval: "month" });
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(j).toMatchObject({ keyId: "rzp_test_abc", subscriptionId: "sub_NEW", amountMinor: 14900, currency: "INR", testMode: true });
      expect(JSON.stringify(j)).not.toContain(SECRET);
    });

    describe("verify", () => {
      const verify = async (b: unknown, headers: Record<string, string> = origin) => (await import("@/app/api/billing/razorpay/verify/route")).POST(post("/api/billing/razorpay/verify", b, headers));
      const ok = () => ({ razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_1", razorpay_signature: sign("pay_1", "sub_1") });
      const row = (user = UID) => ({ id: "r", user_id: user, provider: "razorpay", provider_subscription_id: "sub_1", interval: "month", amount_minor: 14900, currency: "INR", status: "pending", current_period_end: null, cancel_at_period_end: false, created_at: "2026-11-01T00:00:00Z" });
      const provider = () => vi.stubGlobal("fetch", router({ "/subscriptions/sub_1": { id: "sub_1", plan_id: "plan_M", status: "active", current_start: 1_800_000_000, current_end: 1_802_592_000, notes: { user_id: UID } }, "/payments/pay_1": { id: "pay_1", amount: 14900, currency: "INR", status: "captured", created_at: 1_800_000_000 } }));

      it("rejects malformed identifiers and foreign origins", async () => {
        expect((await verify({ razorpay_payment_id: "x", razorpay_subscription_id: "y", razorpay_signature: "z" })).status).toBe(400);
        expect((await verify(ok(), { origin: "https://evil.example" })).status).toBe(403);
      });
      it("a client callback with a forged signature grants nothing", async () => {
        st.tables.billing_subscriptions = row();
        provider();
        const res = await verify({ ...ok(), razorpay_signature: sign("pay_1", "sub_1", "forged") });
        expect(res.status).toBe(400);
        expect(st.rpc).toHaveLength(0);
      });
      it("someone else's subscription cannot be claimed", async () => {
        st.tables.billing_subscriptions = row(OTHER);
        provider();
        expect((await verify(ok())).status).toBe(403);
        expect(st.rpc).toHaveLength(0);
      });
      it("an unknown subscription is not found", async () => {
        expect((await verify(ok())).status).toBe(404);
      });
      it("a genuine, correctly priced payment is recorded and reported", async () => {
        st.tables.billing_subscriptions = row();
        provider();
        const res = await verify(ok());
        expect(await res.json()).toEqual({ status: "active" });
        expect(st.rpc[0].args).toMatchObject({ p_provider: "razorpay", p_event_id: "verify:pay_1", p_user: UID });
        expect(st.rpc[0].args.p_payment).toMatchObject({ amount_minor: 14900, currency: "INR", status: "captured" });
      });
    });
  });
});
