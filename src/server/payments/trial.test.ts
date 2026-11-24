import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PaypalConfig, RazorpayConfig } from "./config";
import { createPaypalSubscription, paypalStateToBilling, readPlanPrice, type PpSubscription, type PpTransaction } from "./paypal";
import { AUTH_CHARGE_MAX_MINOR, cancelRazorpaySubscription, confirmRazorpayCheckout, createRazorpaySubscription, isTrialStart, razorpayEventToBilling } from "./razorpay";
import { BillingError, type BillingEvent } from "./types";

const UID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const SECRET = "rzp_test_secret_value";
const sign = (pay: string, sub: string) => createHmac("sha256", SECRET).update(`${pay}|${sub}`).digest("hex");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const router = (routes: Record<string, unknown>) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    return hit ? json(routes[hit]) : json({ error: "unrouted" }, 500);
  }) as unknown as typeof fetch;
  return Object.assign(f, { calls });
};
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof BillingError ? e.code : "other"));
const bodyOf = (f: { calls: { url: string; init?: RequestInit }[] }, endsWith: string) => JSON.parse(String(f.calls.find((c) => c.url.endsWith(endsWith))!.init!.body));
const allPayments = (p: BillingEvent["payment"]) => (p == null ? [] : Array.isArray(p) ? p : [p]);

describe("free trial: Razorpay", () => {
  const rzY: RazorpayConfig = { keyId: "rzp_test_abc", keySecret: SECRET, webhookSecret: "w", mode: "sandbox", planIds: { year: "plan_Y" } };
  const created = "2026-11-22T10:00:00.000Z";
  const startAt = Math.floor((new Date(created).getTime() + 5 * 86_400_000) / 1000);
  const now = new Date("2026-11-22T10:01:00Z");
  const expectY = { userId: UID, interval: "year" as const, amountMinor: 119900, currency: "INR", createdAt: created };
  const input = { paymentId: "pay_A", subscriptionId: "sub_T", signature: sign("pay_A", "sub_T") };
  const sub = (over = {}) => ({ id: "sub_T", plan_id: "plan_Y", status: "authenticated", customer_id: "cust_1", start_at: startAt, notes: { user_id: UID }, ...over });
  const pay = (over = {}) => ({ id: "pay_A", amount: 500, currency: "INR", status: "captured", ...over });
  const f = (s = sub(), p = pay()) => router({ "/subscriptions/sub_T": s, "/payments/pay_A": p });
  const planOk = { id: "plan_Y", period: "yearly", interval: 1, item: { amount: 119900, currency: "INR" } };

  it("starts the first charge five days out and sends no price from the browser", async () => {
    const fx = router({ "/plans/plan_Y": planOk, "/subscriptions": { id: "sub_T", plan_id: "plan_Y", status: "created" } });
    const r = await createRazorpaySubscription(rzY, "year", UID, fx, { trialDays: 5, now: new Date(created) });
    expect(r).toMatchObject({ id: "sub_T", amountMinor: 119900, trialEndsAt: new Date(startAt * 1000).toISOString() });
    expect(bodyOf(fx, "/subscriptions")).toMatchObject({ plan_id: "plan_Y", start_at: startAt, notes: { user_id: UID } });
    const plain = router({ "/plans/plan_Y": planOk, "/subscriptions": { id: "sub_T" } });
    await createRazorpaySubscription(rzY, "year", UID, plain);
    expect(bodyOf(plain, "/subscriptions")).not.toHaveProperty("start_at");
  });
  it("recognises only the trial end this checkout asked for", () => {
    expect(isTrialStart(startAt, created)).toBe(true);
    expect(isTrialStart(startAt + 3600, created)).toBe(false);
    expect(isTrialStart(null, created)).toBe(false);
    expect(isTrialStart(startAt, null)).toBe(false);
  });
  it("an authorised mandate grants access until the trial end and records no payment", async () => {
    const ev = await confirmRazorpayCheckout(rzY, input, expectY, f(), now);
    expect(ev.subscription).toMatchObject({ provider_subscription_id: "sub_T", status: "active", current_period_end: new Date(startAt * 1000).toISOString() });
    expect(ev.payment).toBeNull(); // the small authentication charge is not a purchase
  });
  it("refuses a trial that is someone else's, on another plan, unauthorised, or with a real-sized or failed charge", async () => {
    expect(await code(confirmRazorpayCheckout(rzY, input, expectY, f(sub({ notes: { user_id: OTHER } })), now))).toBe("owner_mismatch");
    expect(await code(confirmRazorpayCheckout(rzY, input, expectY, f(sub({ plan_id: "plan_CHEAP" })), now))).toBe("plan_mismatch");
    expect(await code(confirmRazorpayCheckout(rzY, input, expectY, f(sub({ status: "created" })), now))).toBe("provider_error");
    expect(await code(confirmRazorpayCheckout(rzY, input, expectY, f(sub(), pay({ amount: AUTH_CHARGE_MAX_MINOR + 1 })), now))).toBe("amount_mismatch");
    expect(await code(confirmRazorpayCheckout(rzY, input, expectY, f(sub(), pay({ status: "failed" })), now))).toBe("amount_mismatch");
    expect(await code(confirmRazorpayCheckout(rzY, { ...input, signature: sign("pay_A", "sub_X") }, expectY, f(), now))).toBe("invalid_signature");
  });
  it("a start date that is not our trial falls back to the full-price check", async () => {
    expect(await code(confirmRazorpayCheckout(rzY, input, expectY, f(sub({ start_at: startAt + 86_400 * 3 }), pay({ amount: 500 })), now))).toBe("amount_mismatch");
  });
  it("webhooks: an authenticated trial grants until the first charge; authentication charges and their refunds are ignored", () => {
    const at = 1_800_000_000;
    const ev = razorpayEventToBilling({ event: "subscription.authenticated", created_at: at, payload: { subscription: { entity: { id: "sub_T", plan_id: "plan_Y", status: "authenticated", start_at: at + 5 * 86_400, notes: { user_id: UID } } } } }, "evt1");
    expect(ev?.subscription).toMatchObject({ status: "active", current_period_end: new Date((at + 5 * 86_400) * 1000).toISOString() });
    expect(ev?.payment).toBeNull();
    expect(razorpayEventToBilling({ event: "refund.processed", payload: { payment: { entity: { id: "pay_A", amount: 500, currency: "INR", refund_status: "full" } } } }, "e2")).toBeNull();
    expect(razorpayEventToBilling({ event: "payment.captured", payload: { payment: { entity: { id: "pay_A", amount: 500, currency: "INR", status: "captured" } } } }, "e3")).toBeNull();
    expect(allPayments(razorpayEventToBilling({ event: "payment.captured", payload: { payment: { entity: { id: "pay_B", amount: 119900, currency: "INR", status: "captured" } } } }, "e4")?.payment ?? null)[0]).toMatchObject({ provider_payment_id: "pay_B", status: "captured" });
  });
  it("the first real charge activates a year of access", () => {
    const at = startAt;
    const ev = razorpayEventToBilling({ event: "subscription.charged", created_at: at, payload: { subscription: { entity: { id: "sub_T", plan_id: "plan_Y", status: "active", current_start: at, current_end: at + 365 * 86_400, notes: { user_id: UID } } }, payment: { entity: { id: "pay_C", amount: 119900, currency: "INR", status: "captured", created_at: at } } } }, "evt2");
    expect(ev?.subscription).toMatchObject({ status: "active", current_period_end: new Date((at + 365 * 86_400) * 1000).toISOString() });
    expect(allPayments(ev?.payment ?? null)[0]).toMatchObject({ provider_payment_id: "pay_C", amount_minor: 119900, status: "captured" });
  });
  it("cancelling a trial not yet charged stops it at once; a running subscription stops at the cycle end", async () => {
    const trial = router({ "/subscriptions/sub_T/cancel": { id: "sub_T", status: "cancelled" }, "/subscriptions/sub_T": sub() });
    expect(await cancelRazorpaySubscription(rzY, "sub_T", trial)).toEqual({ immediate: true });
    expect(bodyOf(trial, "/cancel")).toEqual({ cancel_at_cycle_end: 0 });
    const running = router({ "/subscriptions/sub_T/cancel": { id: "sub_T" }, "/subscriptions/sub_T": sub({ status: "active" }) });
    expect(await cancelRazorpaySubscription(rzY, "sub_T", running)).toEqual({ immediate: false });
    expect(bodyOf(running, "/cancel")).toEqual({ cancel_at_cycle_end: 1 });
  });
});

describe("free trial: PayPal", () => {
  const ppT: PaypalConfig = { clientId: "cid", clientSecret: "csecret", webhookId: "WH-1", mode: "sandbox", baseUrl: "https://api-m.sandbox.paypal.com", planIds: { year: "P-YEAR" }, trialPlanIds: { year: "P-TRIAL" } };
  const tok = { "/oauth2/token": { access_token: "TOKEN", expires_in: 300 } };
  const trialCycle = { tenure_type: "TRIAL", frequency: { interval_unit: "DAY", interval_count: 5 }, pricing_scheme: { fixed_price: { value: "0", currency_code: "USD" } } };
  const regular = { tenure_type: "REGULAR", frequency: { interval_unit: "YEAR", interval_count: 1 }, pricing_scheme: { fixed_price: { value: "23.99", currency_code: "USD" } } };
  const plan = (id: string, billing_cycles: unknown[]) => ({ id, status: "ACTIVE", billing_cycles });
  const now = new Date("2026-11-22T10:00:00Z");
  const live = (over: Partial<PpSubscription> = {}): PpSubscription => ({ id: "I-T", plan_id: "P-TRIAL", status: "ACTIVE", custom_id: UID, start_time: "2026-11-22T09:59:00Z", billing_info: { next_billing_time: "2026-11-27T09:59:00Z", cycle_executions: [{ tenure_type: "TRIAL", cycles_completed: 0, cycles_remaining: 1 }] }, ...over });
  const expectT = { userId: UID, planId: ["P-YEAR", "P-TRIAL"], amountMinor: 2399, currency: "USD", trialPlanIds: ["P-TRIAL"], trialDays: 5 };
  const state = (s: PpSubscription, txs: PpTransaction[] = []) => paypalStateToBilling(s, expectT, { eventId: "e", eventType: "t" }, now, txs);

  it("accepts the trial plan only with exactly the advertised free cycle, and refuses it elsewhere", async () => {
    expect(await readPlanPrice(ppT, "year", router({ ...tok, "/billing/plans/P-TRIAL": plan("P-TRIAL", [trialCycle, regular]) }), { trialDays: 5 })).toEqual({ planId: "P-TRIAL", amountMinor: 2399, currency: "USD" });
    const longer = { ...trialCycle, frequency: { interval_unit: "DAY", interval_count: 30 } };
    expect(await code(readPlanPrice(ppT, "year", router({ ...tok, "/billing/plans/P-TRIAL": plan("P-TRIAL", [longer, regular]) }), { trialDays: 5 }))).toBe("plan_mismatch");
    const paidTrial = { ...trialCycle, pricing_scheme: { fixed_price: { value: "1.00", currency_code: "USD" } } };
    expect(await code(readPlanPrice(ppT, "year", router({ ...tok, "/billing/plans/P-TRIAL": plan("P-TRIAL", [paidTrial, regular]) }), { trialDays: 5 }))).toBe("plan_mismatch");
    expect(await code(readPlanPrice(ppT, "year", router({ ...tok, "/billing/plans/P-YEAR": plan("P-YEAR", [trialCycle, regular]) })))).toBe("plan_mismatch"); // a plain plan has no free cycle
    expect(await code(readPlanPrice({ ...ppT, trialPlanIds: {} }, "year", router(tok), { trialDays: 5 }))).toBe("interval_unavailable");
    expect(await code(readPlanPrice(ppT, "month", router(tok), { trialDays: 5 }))).toBe("interval_unavailable");
  });
  it("creates the subscription on the trial plan", async () => {
    const f = router({ ...tok, "/billing/plans/P-TRIAL": plan("P-TRIAL", [trialCycle, regular]), "/billing/subscriptions": { id: "I-T", status: "APPROVAL_PENDING", links: [{ rel: "approve", href: "https://www.paypal.com/webapps/billing/subscriptions?ba_token=X" }] } });
    await createPaypalSubscription(ppT, "year", UID, { returnUrl: "r", cancelUrl: "c", brand: "FinTrack" }, f, { trialDays: 5 });
    expect(bodyOf(f, "/billing/subscriptions")).toMatchObject({ plan_id: "P-TRIAL", custom_id: UID });
  });
  it("an active subscription inside its free cycle grants access until the first charge, with no payment", () => {
    const ev = state(live());
    expect(ev.subscription).toMatchObject({ status: "active", current_period_end: "2026-11-27T09:59:00Z" });
    expect(ev.payment).toBeNull();
  });
  it("a trial is not granted for the plain plan, outside the free cycle, too far out, or when not active", () => {
    expect(state(live({ plan_id: "P-YEAR" })).subscription?.status).toBe("pending");
    expect(state(live({ billing_info: { next_billing_time: "2026-11-27T09:59:00Z", cycle_executions: [{ tenure_type: "REGULAR", cycles_remaining: 1 }] } })).subscription?.status).toBe("pending");
    expect(state(live({ billing_info: { next_billing_time: "2027-02-01T00:00:00Z", cycle_executions: [{ tenure_type: "TRIAL", cycles_remaining: 1 }] } })).subscription?.status).toBe("pending");
    expect(state(live({ status: "APPROVAL_PENDING" })).subscription?.status).toBe("pending");
    expect(state(live({ status: "SUSPENDED" })).subscription?.status).toBe("past_due");
  });
  it("after the first charge, the real payment at the plan price extends access a year", () => {
    const after = live({ billing_info: { next_billing_time: "2027-11-27T09:59:00Z", cycle_executions: [{ tenure_type: "TRIAL", cycles_remaining: 0 }, { tenure_type: "REGULAR", cycles_completed: 1, cycles_remaining: 0 }] } });
    const tx: PpTransaction = { id: "SALE-9", status: "COMPLETED", time: "2026-11-27T09:59:30Z", amount_with_breakdown: { gross_amount: { currency_code: "USD", value: "23.99" } } };
    const paid = paypalStateToBilling(after, expectT, { eventId: "e", eventType: "t" }, new Date("2026-11-28T00:00:00Z"), [tx]);
    expect(paid.subscription).toMatchObject({ status: "active", current_period_end: "2027-11-27T09:59:00Z" });
    expect(allPayments(paid.payment)[0]).toMatchObject({ provider_payment_id: "SALE-9", amount_minor: 2399, status: "captured" });
  });
});
