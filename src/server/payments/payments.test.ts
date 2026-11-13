import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_PAYMENTS_ALLOWED, paymentsStatus } from "./config";
import { resolveEntitlement } from "./entitlements";
import { razorpayEventToUpdate, verifyRazorpaySignature } from "./webhooks";

const NOW = new Date("2026-11-13T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 864e5).toISOString();

describe("payments configuration", () => {
  it("live payments are disabled in code, whatever the environment says", () => {
    expect(LIVE_PAYMENTS_ALLOWED).toBe(false);
    const s = paymentsStatus({ RAZORPAY_KEY_ID: "k", RAZORPAY_KEY_SECRET: "s", PAYPAL_CLIENT_ID: "c", PAYPAL_CLIENT_SECRET: "s", PAYMENTS_LIVE: "true", PAYMENTS_MODE: "live" });
    expect(s).toEqual({ mode: "sandbox", configured: ["razorpay", "paypal"], checkoutOpen: false });
  });
  it("with no credentials nothing is configured", () => {
    expect(paymentsStatus({})).toEqual({ mode: "sandbox", configured: [], checkoutOpen: false });
  });
  it("a provider counts as configured only with both id and secret", () => {
    expect(paymentsStatus({ RAZORPAY_KEY_ID: "k" }).configured).toEqual([]);
    expect(paymentsStatus({ PAYPAL_CLIENT_ID: "c", PAYPAL_CLIENT_SECRET: "s" }).configured).toEqual(["paypal"]);
  });
});

describe("entitlement resolution", () => {
  it("no record means Free", () => {
    expect(resolveEntitlement(null, NOW)).toMatchObject({ plan: "free", reason: "free" });
    expect(resolveEntitlement(undefined, NOW).plan).toBe("free");
  });
  it("an active paid plan applies until its period ends, then lapses to Free", () => {
    expect(resolveEntitlement({ plan: "pro", status: "active", current_period_end: day(10) }, NOW)).toMatchObject({ plan: "pro", reason: "paid" });
    expect(resolveEntitlement({ plan: "pro", status: "active", current_period_end: day(-1) }, NOW)).toMatchObject({ plan: "free", reason: "lapsed" });
  });
  it("a trial applies until it ends", () => {
    expect(resolveEntitlement({ plan: "pro", status: "trialing", current_period_end: day(3) }, NOW)).toMatchObject({ plan: "pro", reason: "trial" });
    expect(resolveEntitlement({ plan: "pro", status: "trialing", current_period_end: day(-1) }, NOW).plan).toBe("free");
  });
  it("a failed renewal gets a seven-day grace period, then Free", () => {
    expect(resolveEntitlement({ plan: "pro", status: "past_due", current_period_end: day(-3) }, NOW)).toMatchObject({ plan: "pro", reason: "grace" });
    expect(resolveEntitlement({ plan: "pro", status: "past_due", current_period_end: day(-8) }, NOW).plan).toBe("free");
  });
  it("a cancelled plan runs to the end of the period already paid for", () => {
    expect(resolveEntitlement({ plan: "pro", status: "canceled", current_period_end: day(5) }, NOW).plan).toBe("pro");
    expect(resolveEntitlement({ plan: "pro", status: "canceled", current_period_end: day(-1) }, NOW).plan).toBe("free");
  });
  it("missing or malformed billing data can never grant paid access", () => {
    expect(resolveEntitlement({ plan: "pro", status: "active", current_period_end: null }, NOW).plan).toBe("free");
    expect(resolveEntitlement({ plan: "pro", status: "active", current_period_end: "not a date" }, NOW).plan).toBe("free");
    expect(resolveEntitlement({ plan: "free", status: "active", current_period_end: day(30) }, NOW).plan).toBe("free");
  });
});

describe("razorpay signature", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "subscription.activated" });
  const sign = (b: string, s = secret) => createHmac("sha256", s).update(b).digest("hex");
  it("accepts the correct signature", () => expect(verifyRazorpaySignature(body, sign(body), secret)).toBe(true));
  it("rejects a tampered body, a wrong secret, a missing or malformed signature", () => {
    expect(verifyRazorpaySignature(body + " ", sign(body), secret)).toBe(false);
    expect(verifyRazorpaySignature(body, sign(body, "other"), secret)).toBe(false);
    expect(verifyRazorpaySignature(body, null, secret)).toBe(false);
    expect(verifyRazorpaySignature(body, "short", secret)).toBe(false);
    expect(verifyRazorpaySignature(body, sign(body), "")).toBe(false);
  });
});

describe("razorpay event mapping", () => {
  const uid = "11111111-2222-4333-8444-555555555555";
  const ev = (event: string, notes: unknown = { user_id: uid }, end: number | null = 1_800_000_000) => ({ event, payload: { subscription: { entity: { id: "sub_1", status: "x", current_end: end, notes } } } });
  it.each([["subscription.activated", "active"], ["subscription.charged", "active"], ["subscription.halted", "past_due"], ["subscription.cancelled", "canceled"], ["subscription.completed", "canceled"]])("%s -> %s", (event, status) => {
    expect(razorpayEventToUpdate(ev(event))).toEqual({ userId: uid, row: { plan: "pro", status, current_period_end: new Date(1_800_000_000 * 1000).toISOString(), provider: "razorpay", provider_ref: "sub_1" } });
  });
  it("ignores events that change nothing, and events without a valid FinTrack user", () => {
    expect(razorpayEventToUpdate(ev("payment.captured"))).toBeNull();
    expect(razorpayEventToUpdate(ev("subscription.activated", {}))).toBeNull();
    expect(razorpayEventToUpdate(ev("subscription.activated", { user_id: "not-a-uuid" }))).toBeNull();
    expect(razorpayEventToUpdate({})).toBeNull();
    expect(razorpayEventToUpdate(null)).toBeNull();
  });
});

describe("razorpay webhook route", () => {
  const secret = "whsec_route";
  const uid = "11111111-2222-4333-8444-555555555555";
  const body = JSON.stringify({ event: "subscription.activated", payload: { subscription: { entity: { id: "sub_9", current_end: 1_800_000_000, notes: { user_id: uid } } } } });
  const sign = (b: string) => createHmac("sha256", secret).update(b).digest("hex");
  const st = vi.hoisted(() => ({ inserts: [] as Record<string, unknown>[], upserts: [] as Record<string, unknown>[], dupError: null as { message: string } | null, adminOn: true }));
  vi.mock("@/server/admin", () => ({
    createAdminClient: () =>
      st.adminOn
        ? {
            from: (t: string) => ({
              insert: async (row: Record<string, unknown>) => (t === "payment_events" ? (st.inserts.push(row), { error: st.dupError }) : { error: null }),
              upsert: async (row: Record<string, unknown>) => (st.upserts.push(row), { error: null }),
              delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
            }),
          }
        : null,
  }));
  const call = async (b: string, headers: Record<string, string>) => {
    const { POST } = await import("@/app/api/webhooks/razorpay/route");
    return POST(new NextRequest("http://127.0.0.1:3100/api/webhooks/razorpay", { method: "POST", body: b, headers }));
  };
  beforeEach(() => {
    st.inserts.length = 0;
    st.upserts.length = 0;
    st.dupError = null;
    st.adminOn = true;
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", secret);
  });

  it("answers 503 and changes nothing until credentials exist", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    const res = await call(body, { "x-razorpay-signature": sign(body), "x-razorpay-event-id": "e1" });
    expect(res.status).toBe(503);
    expect(st.upserts).toHaveLength(0);
    st.adminOn = false;
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", secret);
    expect((await call(body, { "x-razorpay-signature": sign(body), "x-razorpay-event-id": "e1" })).status).toBe(503);
  });
  it("rejects an invalid signature before touching anything", async () => {
    const res = await call(body, { "x-razorpay-signature": "bad", "x-razorpay-event-id": "e1" });
    expect(res.status).toBe(400);
    expect(st.inserts).toHaveLength(0);
    expect(st.upserts).toHaveLength(0);
  });
  it("a valid event updates only the entitlement, once", async () => {
    const res = await call(body, { "x-razorpay-signature": sign(body), "x-razorpay-event-id": "evt_1" });
    expect(res.status).toBe(200);
    expect(st.inserts).toEqual([{ provider: "razorpay", event_id: "evt_1" }]);
    expect(st.upserts).toHaveLength(1);
    expect(st.upserts[0]).toMatchObject({ user_id: uid, plan: "pro", status: "active", provider: "razorpay", provider_ref: "sub_9" });
  });
  it("a repeated event id is acknowledged and not processed again", async () => {
    st.dupError = { message: "duplicate key" };
    const res = await call(body, { "x-razorpay-signature": sign(body), "x-razorpay-event-id": "evt_1" });
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(st.upserts).toHaveLength(0);
  });
  it("requires an event id", async () => {
    expect((await call(body, { "x-razorpay-signature": sign(body) })).status).toBe(400);
  });
});
