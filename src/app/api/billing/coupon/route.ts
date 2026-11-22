import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/server/admin";
import { checkCoupon } from "@/server/payments/coupons";
import { billingFailure, currentUser, INTERVALS, sameOrigin } from "@/server/payments/http";
import { BillingError } from "@/server/payments/types";

/**
 * "Does this code work for me?", asked by the billing form before checkout. It answers with what the code gives (the
 * trial length) or a plain reason it does not. It only reads: nothing is used up until the subscription that used the
 * code starts. Attempts are limited per person, and every failure other than expiry or reuse reads the same, so codes
 * cannot be probed.
 */
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) throw new BillingError("invalid_request", 403);
    const session = await currentUser();
    if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    const admin = createAdminClient();
    if (!admin) throw new BillingError("not_configured", 503);
    const body = z.object({ code: z.string().min(1).max(40), interval: z.enum(INTERVALS), provider: z.enum(["razorpay", "paypal"]) }).safeParse(await request.json().catch(() => null));
    if (!body.success) throw new BillingError("invalid_request");
    const coupon = await checkCoupon(admin, { code: body.data.code, interval: body.data.interval, userId: session.user.id, provider: body.data.provider });
    return NextResponse.json({ valid: true, code: coupon.code, trialDays: coupon.trial_days });
  } catch (e) {
    return billingFailure(e);
  }
}
