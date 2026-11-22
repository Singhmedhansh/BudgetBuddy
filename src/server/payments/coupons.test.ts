import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PaypalConfig, RazorpayConfig } from "./config";
import { checkCoupon, COUPON_CHECKS_PER_HOUR, couponProblem, normalizeCode, validCodeShape, type Coupon } from "./coupons";
import { createPaypalSubscription, paypalStateToBilling, readPlanPrice, type PpSubscription } from "./paypal";
import { confirmRazorpayCheckout, createRazorpaySubscription, isTrialStart } from "./razorpay";
import type { Admin } from "./store";
import { BillingError } from "./types";

const UID = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-22T10:00:00Z");
const coupon = (over: Partial<Coupon> = {}): Coupon => ({ id: "c1", code: "INSTA30", campaign: "instagram", kind: "trial_days", trial_days: 30, intervals: ["month", "year"], paypal_plan_ids: { month: "P-M30", year: "P-Y30" }, max_redemptions: 100, redeemed_count: 3, valid_from: null, valid_until: null, active: true, ...over });
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof BillingError ? e.code : "other:" + String(e)));
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const router = (routes: Record<string, unknown>) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    return hit ? json(routes[hit]) : new Response("{}", { status: 500 });
  }) as unknown as typeof fetch;
  return Object.assign(f, { calls });
};

describe("coupon rules", () => {
  it("normalises what people type", () => {
    expect(normalizeCode(" insta 30 ")).toBe("INSTA30");
    expect(validCodeShape("INSTA30")).toBe(true);
    expect(validCodeShape("no")).toBe(false);
    expect(validCodeShape("HAS SPACE")).toBe(false);
    expect(validCodeShape("A".repeat(33))).toBe(false);
  });
  it("accepts a live code and explains every refusal", () => {
    expect(couponProblem(coupon(), "month", NOW)).toBeNull();
    expect(couponProblem(null, "month", NOW)).toBe("unknown");
    expect(couponProblem(coupon({ active: false }), "month", NOW)).toBe("unknown");
    expect(couponProblem(coupon({ valid_from: "2026-12-01T00:00:00Z" }), "month", NOW)).toBe("not_started");
    expect(couponProblem(coupon({ valid_until: "2026-11-01T00:00:00Z" }), "month", NOW)).toBe("expired");
    expect(couponProblem(coupon({ max_redemptions: 3, redeemed_count: 3 }), "month", NOW)).toBe("exhausted");
    expect(couponProblem(coupon({ intervals: ["year"] }), "month", NOW)).toBe("interval");
    expect(couponProblem(coupon({ max_redemptions: null, redeemed_count: 9999 }), "year", NOW)).toBeNull();
  });
});

/** A fake service client: one coupon row, a count for audit attempts, redemptions and earlier subscriptions. */
function fakeAdmin(opts: { coupon?: Coupon | null; attempts?: number; redeemed?: number; startedBefore?: number }) {
  const audits: unknown[] = [];
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ["select", "eq", "gte", "not", "lt", "in"]) chain[m] = self;
      chain.insert = (row: unknown) => (audits.push(row), Promise.resolve({ error: null }));
      chain.maybeSingle = async () => ({ data: table === "billing_coupons" ? opts.coupon ?? null : null });
      chain.then = (res: (v: unknown) => unknown) =>
        res({ count: table === "billing_audit" ? opts.attempts ?? 0 : table === "billing_coupon_redemptions" ? opts.redeemed ?? 0 : opts.startedBefore ?? 0, data: [], error: null });
      return chain;
    },
  };
  return { admin: admin as unknown as Admin, audits };
}

describe("checking a code for a person", () => {
  const run = (o: Parameters<typeof fakeAdmin>[0], provider: "razorpay" | "paypal" = "razorpay", interval: "month" | "year" = "year", raw = "insta30") => {
    const f = fakeAdmin(o);
    return { f, result: code(checkCoupon(f.admin, { code: raw, interval, userId: UID, provider }, NOW)) };
  };
  it("accepts a valid code for a first-time subscriber and records only the attempt", async () => {
    const { f, result } = run({ coupon: coupon() });
    expect(await result).toBe("ok");
    expect(f.audits).toHaveLength(1);
  });
  it("refuses an unknown or malformed code with the generic message", async () => {
    expect(await run({ coupon: null }).result).toBe("coupon_invalid");
    expect(await run({ coupon: coupon() }, "razorpay", "year", "x").result).toBe("coupon_invalid");
  });
  it("refuses an expired code, a used-up code, a repeat use, and a person who has subscribed before", async () => {
    expect(await run({ coupon: coupon({ valid_until: "2026-11-01T00:00:00Z" }) }).result).toBe("coupon_expired");
    expect(await run({ coupon: coupon({ max_redemptions: 3, redeemed_count: 3 }) }).result).toBe("coupon_invalid");
    expect(await run({ coupon: coupon(), redeemed: 1 }).result).toBe("coupon_used");
    expect(await run({ coupon: coupon(), startedBefore: 1 }).result).toBe("coupon_not_eligible");
  });
  it("needs a PayPal plan with this trial length for PayPal", async () => {
    expect(await run({ coupon: coupon({ paypal_plan_ids: {} }) }, "paypal").result).toBe("coupon_invalid");
    expect(await run({ coupon: coupon() }, "paypal").result).toBe("ok");
  });
  it("limits attempts per person per hour", async () => {
    expect(await run({ coupon: coupon(), attempts: COUPON_CHECKS_PER_HOUR }).result).toBe("rate_limited");
  });
});

describe("a coupon's trial length, end to end per provider", () => {
  const SECRET = "rzp_test_secret_value";
  const rz: RazorpayConfig = { keyId: "rzp_test_abc", keySecret: SECRET, webhookSecret: "w", mode: "sandbox", planIds: { month: "plan_M", year: "plan_Y" } };
  const created = "2026-11-22T10:00:00.000Z";
  const sign = (pay: string, sub: string) => createHmac("sha256", SECRET).update(`${pay}|${sub}`).digest("hex");

  it("Razorpay: the first charge is deferred by the code's days and verification expects exactly that", async () => {
    const plan = { id: "plan_M", period: "monthly", interval: 1, item: { amount: 14900, currency: "INR" } };
    const fx = router({ "/plans/plan_M": plan, "/subscriptions": { id: "sub_C", plan_id: "plan_M", status: "created" } });
    const r = await createRazorpaySubscription(rz, "month", UID, fx, { trialDays: 30, now: new Date(created) });
    const startAt = Math.floor((new Date(created).getTime() + 30 * 86_400_000) / 1000);
    expect(r.trialEndsAt).toBe(new Date(startAt * 1000).toISOString());
    expect(JSON.parse(String(fx.calls.find((c) => c.url.endsWith("/subscriptions"))!.init!.body))).toMatchObject({ start_at: startAt, plan_id: "plan_M" });
    expect(isTrialStart(startAt, created, 30)).toBe(true);
    expect(isTrialStart(startAt, created, 5)).toBe(false);
    const sub = { id: "sub_C", plan_id: "plan_M", status: "authenticated", start_at: startAt, notes: { user_id: UID } };
    const f = router({ "/subscriptions/sub_C": sub, "/payments/pay_C": { id: "pay_C", amount: 500, currency: "INR", status: "captured" } });
    const input = { paymentId: "pay_C", subscriptionId: "sub_C", signature: sign("pay_C", "sub_C") };
    const ok = await confirmRazorpayCheckout(rz, input, { userId: UID, interval: "month", amountMinor: 14900, currency: "INR", createdAt: created, trialDays: 30 }, f, new Date("2026-11-22T10:01:00Z"));
    expect(ok.subscription).toMatchObject({ status: "active", current_period_end: new Date(startAt * 1000).toISOString() });
    // The same subscription is not a 5-day trial, so it is held to the full-price check instead.
    expect(await code(confirmRazorpayCheckout(rz, input, { userId: UID, interval: "month", amountMinor: 14900, currency: "INR", createdAt: created, trialDays: 5 }, f, new Date("2026-11-22T10:01:00Z")))).toBe("amount_mismatch");
  });

  const pp: PaypalConfig = { clientId: "c", clientSecret: "s", webhookId: "W", mode: "sandbox", baseUrl: "https://api-m.sandbox.paypal.com", planIds: { month: "P-M" }, trialPlanIds: { month: "P-M5" } };
  const tok = { "/oauth2/token": { access_token: "T", expires_in: 300 } };
  const cyc = (days: number) => [
    { tenure_type: "TRIAL", frequency: { interval_unit: "DAY", interval_count: days }, pricing_scheme: { fixed_price: { value: "0", currency_code: "USD" } } },
    { tenure_type: "REGULAR", frequency: { interval_unit: "MONTH", interval_count: 1 }, pricing_scheme: { fixed_price: { value: "2.99", currency_code: "USD" } } },
  ];
  it("PayPal: a code's own plan must have exactly the promised trial length", async () => {
    expect(await readPlanPrice(pp, "month", router({ ...tok, "/billing/plans/P-M30": { id: "P-M30", status: "ACTIVE", billing_cycles: cyc(30) } }), { trialDays: 30, planId: "P-M30" })).toEqual({ planId: "P-M30", amountMinor: 299, currency: "USD" });
    expect(await code(readPlanPrice(pp, "month", router({ ...tok, "/billing/plans/P-M30": { id: "P-M30", status: "ACTIVE", billing_cycles: cyc(7) } }), { trialDays: 30, planId: "P-M30" }))).toBe("plan_mismatch");
  });
  it("PayPal: subscription is created on the code's plan and a 30-day trial is granted until its first charge", async () => {
    const f = router({ ...tok, "/billing/plans/P-M30": { id: "P-M30", status: "ACTIVE", billing_cycles: cyc(30) }, "/billing/subscriptions": { id: "I-C", status: "APPROVAL_PENDING", links: [{ rel: "approve", href: "https://www.paypal.com/x" }] } });
    const r = await createPaypalSubscription(pp, "month", UID, { returnUrl: "r", cancelUrl: "c", brand: "FinTrack" }, f, { trialDays: 30, planId: "P-M30" });
    expect(r.planId).toBe("P-M30");
    expect(JSON.parse(String(f.calls.find((c) => c.url.endsWith("/billing/subscriptions"))!.init!.body))).toMatchObject({ plan_id: "P-M30", custom_id: UID });
    const live: PpSubscription = { id: "I-C", plan_id: "P-M30", status: "ACTIVE", custom_id: UID, billing_info: { next_billing_time: "2026-12-21T10:00:00Z", cycle_executions: [{ tenure_type: "TRIAL", cycles_completed: 0, cycles_remaining: 1 }] } };
    const ev = paypalStateToBilling(live, { userId: UID, planId: ["P-M", "P-M5", "P-M30"], amountMinor: 299, currency: "USD", trialPlanIds: ["P-M5", "P-M30"], trialDays: 30 }, { eventId: "e", eventType: "t" }, NOW, []);
    expect(ev.subscription).toMatchObject({ status: "active", current_period_end: "2026-12-21T10:00:00Z" });
    // A 30-day first charge is too far out for a subscription that promised only the standard 5-day trial.
    const short = paypalStateToBilling(live, { userId: UID, planId: ["P-M30"], amountMinor: 299, currency: "USD", trialPlanIds: ["P-M30"], trialDays: 5 }, { eventId: "e", eventType: "t" }, NOW, []);
    expect(short.subscription?.status).toBe("pending");
  });
});
