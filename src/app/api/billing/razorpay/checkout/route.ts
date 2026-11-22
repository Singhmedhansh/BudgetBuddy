import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BRAND } from "@/config/brand";
import { TRIAL_DAYS } from "@/config/plans";
import { createAdminClient } from "@/server/admin";
import { checkCoupon, type Coupon } from "@/server/payments/coupons";
import { isRazorpayOrderMode, razorpayConfig } from "@/server/payments/config";
import { billingFailure, currentUser, INTERVALS, sameOrigin } from "@/server/payments/http";
import { createRazorpayOrder, createRazorpaySubscription, expectedRazorpayPrice } from "@/server/payments/razorpay";
import { insertPending, reservePending, trialEligible } from "@/server/payments/store";
import { BillingError } from "@/server/payments/types";

/**
 * Step 1 of paying with Razorpay. With no Razorpay plan ids configured this is Standard Checkout: the server creates an
 * order for the price-list amount (a one-time payment that buys one month or one year). With plan ids it creates a
 * recurring subscription, which starts with the free trial for a first-time subscriber (the first charge is deferred by
 * the trial length, or by the days a promotion code grants). Only what Checkout needs leaves the server: the public key id
 * and the order or subscription id. The price, the trial and the code's meaning are never accepted from the browser.
 */
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) throw new BillingError("invalid_request", 403);
    const session = await currentUser();
    if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    const cfg = razorpayConfig();
    const admin = createAdminClient();
    if (!cfg || !admin) throw new BillingError("not_configured", 503);
    const body = z.object({ interval: z.enum(INTERVALS), coupon: z.string().max(40).optional() }).safeParse(await request.json().catch(() => null));
    if (!body.success) throw new BillingError("invalid_request");
    const { interval } = body.data;
    const orderMode = isRazorpayOrderMode(cfg);
    if (!orderMode && !cfg.planIds[interval]) throw new BillingError("interval_unavailable");

    // A code needs a subscription (a mandate), so it cannot apply to a one-time order.
    let coupon: Coupon | null = null;
    if (body.data.coupon?.trim()) {
      if (orderMode) throw new BillingError("coupon_invalid");
      coupon = await checkCoupon(admin, { code: body.data.coupon, interval, userId: session.user.id, provider: "razorpay" });
    }
    const { existing } = await reservePending(admin, { userId: session.user.id, provider: "razorpay", interval });
    // A free trial for a first subscription only, and only as a subscription (it needs a mandate).
    const trialDays = orderMode ? 0 : coupon ? coupon.trial_days : (await trialEligible(admin, session.user.id)) ? TRIAL_DAYS : 0;
    // An unfinished checkout made with a different code (or none) is retired rather than reused with the wrong terms.
    let providerId = existing?.provider_subscription_id;
    if (existing && (existing.coupon_id ?? null) !== (coupon?.id ?? null)) {
      await admin.from("billing_subscriptions").update({ status: "expired" }).eq("id", existing.id);
      providerId = undefined;
    }
    if (!providerId) {
      const created = orderMode ? await createRazorpayOrder(cfg, interval, session.user.id) : await createRazorpaySubscription(cfg, interval, session.user.id, undefined, { trialDays });
      await insertPending(admin, { userId: session.user.id, provider: "razorpay", providerSubscriptionId: created.id, interval, amountMinor: created.amountMinor, currency: created.currency, ...(coupon ? { couponId: coupon.id, trialDays } : {}) });
      providerId = created.id;
    }
    const price = expectedRazorpayPrice(interval);
    const period = interval === "month" ? "1 month" : "1 year";
    const billed = interval === "month" ? "monthly" : "yearly";
    return NextResponse.json({
      mode: orderMode ? "order" : "subscription",
      keyId: cfg.keyId,
      ...(orderMode ? { orderId: providerId } : { subscriptionId: providerId }),
      name: BRAND.name,
      trial: trialDays > 0,
      trialDays,
      description: orderMode ? `FinTrack One, ${period}` : trialDays > 0 ? `FinTrack One: ${trialDays} days free, then billed ${billed}` : `FinTrack One, billed ${billed}`,
      amountMinor: price.amountMinor,
      currency: price.currency,
      email: session.user.email ?? "",
      testMode: cfg.mode === "sandbox",
    });
  } catch (e) {
    return billingFailure(e);
  }
}
