import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LIVE_PAYMENTS_ALLOWED, paymentsStatus } from "./config";
import { resolveEntitlement } from "./entitlements";
import { verifyRazorpaySignature } from "./webhooks";

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
