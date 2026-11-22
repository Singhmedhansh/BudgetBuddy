import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TRIAL_DAYS } from "@/config/plans";
import { createAdminClient } from "@/server/admin";
import { razorpayConfig } from "@/server/payments/config";
import { billingFailure, currentUser, sameOrigin } from "@/server/payments/http";
import { confirmRazorpayCheckout, confirmRazorpayOrderPayment } from "@/server/payments/razorpay";
import { applyBillingEvent, audit, findSubscription } from "@/server/payments/store";
import { BillingError } from "@/server/payments/types";

/**
 * Step 2 of paying with Razorpay. The browser reports three identifiers after Checkout closes (payment id, signature,
 * and the order id for a one-time payment or the subscription id for a recurring one). Nothing it says grants access:
 * the signature is verified (HMAC-SHA256 of `order_id|payment_id`, or `payment_id|subscription_id`), the order or
 * subscription and the payment are read back from Razorpay, the amount, currency and owner are checked against what the
 * server recorded when checkout began, and only then is the payment recorded and the plan updated, in one transaction.
 * A mismatch or missing field is a 400 and nothing is marked paid.
 */
const signature = z.string().regex(/^[a-f0-9]{64}$/);
const payment = z.string().regex(/^pay_[A-Za-z0-9]+$/);
const schema = z.union([
  z.object({ razorpay_payment_id: payment, razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]+$/), razorpay_signature: signature }),
  z.object({ razorpay_payment_id: payment, razorpay_subscription_id: z.string().regex(/^sub_[A-Za-z0-9]+$/), razorpay_signature: signature }),
]);

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) throw new BillingError("invalid_request", 403);
    const session = await currentUser();
    if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    const cfg = razorpayConfig();
    const admin = createAdminClient();
    if (!cfg || !admin) throw new BillingError("not_configured", 503);
    const body = schema.safeParse(await request.json().catch(() => null));
    if (!body.success) throw new BillingError("invalid_request");
    const data = body.data;
    const providerId = "razorpay_order_id" in data ? data.razorpay_order_id : data.razorpay_subscription_id;

    const row = await findSubscription(admin, "razorpay", providerId);
    if (!row) throw new BillingError("not_found", 404);
    if (row.user_id !== session.user.id) throw new BillingError("owner_mismatch", 403);

    const expect = { userId: session.user.id, interval: row.interval, amountMinor: row.amount_minor, currency: row.currency, createdAt: row.created_at, trialDays: row.trial_days ?? TRIAL_DAYS };
    const confirm =
      "razorpay_order_id" in data
        ? confirmRazorpayOrderPayment(cfg, { paymentId: data.razorpay_payment_id, orderId: data.razorpay_order_id, signature: data.razorpay_signature }, expect)
        : confirmRazorpayCheckout(cfg, { paymentId: data.razorpay_payment_id, subscriptionId: data.razorpay_subscription_id, signature: data.razorpay_signature }, expect);
    const event = await confirm.catch(async (e) => {
      if (e instanceof BillingError && e.code !== "provider_error") await audit(admin, { userId: session.user.id, provider: "razorpay", actor: "checkout", action: "verification_failed", detail: { reason: e.code, subscription: row.provider_subscription_id } });
      throw e;
    });
    await applyBillingEvent(admin, event);
    // The webhook may arrive first or second; either order ends in the same state.
    return NextResponse.json({ status: event.subscription?.status === "active" ? "active" : "processing" });
  } catch (e) {
    return billingFailure(e);
  }
}
