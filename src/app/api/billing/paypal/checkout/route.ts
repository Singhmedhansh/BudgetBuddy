import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BRAND } from "@/config/brand";
import { TRIAL_DAYS } from "@/config/plans";
import { createAdminClient } from "@/server/admin";
import { checkCoupon, type Coupon } from "@/server/payments/coupons";
import { paypalConfig } from "@/server/payments/config";
import { billingFailure, currentUser, INTERVALS, sameOrigin } from "@/server/payments/http";
import { createPaypalSubscription, getPaypalSubscription } from "@/server/payments/paypal";
import { insertPending, reservePending, trialEligible } from "@/server/payments/store";
import { BillingError } from "@/server/payments/types";
import { siteUrl } from "@/server/site-url";

/**
 * Step 1 of paying with PayPal. Creates the subscription on the server and returns PayPal's own approval address.
 * A first-time subscriber gets the plan that begins with the free trial (the standard one, or the one a promotion code
 * names); everyone else gets the plain plan. Approval alone grants nothing: access is decided later, from PayPal's
 * record, in the return route and the webhook.
 */
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) throw new BillingError("invalid_request", 403);
    const session = await currentUser();
    if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    const cfg = paypalConfig();
    const admin = createAdminClient();
    if (!cfg || !admin) throw new BillingError("not_configured", 503);
    const body = z.object({ interval: z.enum(INTERVALS), coupon: z.string().max(40).optional(), startNow: z.boolean().optional() }).safeParse(await request.json().catch(() => null));
    if (!body.success) throw new BillingError("invalid_request");
    const { interval } = body.data;
    // "Start now": the plain plan, paid today, no free trial. A code only grants trial days, so it is ignored then.
    const startNow = body.data.startNow === true;
    if (!cfg.planIds[interval]) throw new BillingError("interval_unavailable");

    let coupon: Coupon | null = null;
    if (body.data.coupon?.trim() && !startNow) coupon = await checkCoupon(admin, { code: body.data.coupon, interval, userId: session.user.id, provider: "paypal" });
    const { existing } = await reservePending(admin, { userId: session.user.id, provider: "paypal", interval });
    // The trial plan: a coupon's own, else the standard one when it exists for this period; none when not eligible or starting now.
    const eligible = startNow ? false : coupon ? true : await trialEligible(admin, session.user.id);
    const planId = coupon ? coupon.paypal_plan_ids[interval] : eligible ? cfg.trialPlanIds?.[interval] : undefined;
    const trialDays = planId ? (coupon ? coupon.trial_days : TRIAL_DAYS) : 0;
    const trialOpts = planId ? { trialDays, planId } : {};

    if (existing) {
      // Reuse an approval that has not been completed (and that was made with the same terms); otherwise retire it and start fresh.
      const sameTerms = (existing.coupon_id ?? null) === (coupon?.id ?? null) && (existing.trial_days ?? 0) === trialDays;
      const live = sameTerms ? await getPaypalSubscription(cfg, existing.provider_subscription_id).catch(() => null) : null;
      const approve = live?.status === "APPROVAL_PENDING" ? live.links?.find((l) => l.rel === "approve")?.href : undefined;
      if (approve) return NextResponse.json({ approveUrl: approve, trial: trialDays > 0, trialDays, testMode: cfg.mode === "sandbox" });
      await admin.from("billing_subscriptions").update({ status: "expired" }).eq("id", existing.id);
    }
    const origin = await siteUrl();
    const created = await createPaypalSubscription(cfg, interval, session.user.id, { returnUrl: `${origin}/api/billing/paypal/return`, cancelUrl: `${origin}/app/checkout?checkout=cancelled`, brand: BRAND.name }, undefined, trialOpts);
    await insertPending(admin, { userId: session.user.id, provider: "paypal", providerSubscriptionId: created.id, interval, amountMinor: created.amountMinor, currency: created.currency, trialDays, ...(coupon ? { couponId: coupon.id, planRef: created.planId } : {}) });
    return NextResponse.json({ approveUrl: created.approveUrl, trial: trialDays > 0, trialDays, testMode: cfg.mode === "sandbox" });
  } catch (e) {
    return billingFailure(e);
  }
}
