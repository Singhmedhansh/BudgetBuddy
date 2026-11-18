import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/server/admin";
import { razorpayConfig } from "@/server/payments/config";
import { billingFailure, currentUser, sameOrigin } from "@/server/payments/http";
import { confirmRazorpayCheckout } from "@/server/payments/razorpay";
import { applyBillingEvent, audit, findSubscription } from "@/server/payments/store";
import { BillingError } from "@/server/payments/types";

/**
 * Step 2 of paying with Razorpay. The browser reports three identifiers after Checkout closes. Nothing it says grants
 * access: the signature is verified, the subscription and payment are read back from Razorpay, the amount, currency,
 * plan and owner are checked against what the server recorded when checkout began, and only then is the payment
 * recorded and the plan updated, in one database transaction.
 */
const schema = z.object({ razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]+$/), razorpay_subscription_id: z.string().regex(/^sub_[A-Za-z0-9]+$/), razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/) });

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

    const row = await findSubscription(admin, "razorpay", body.data.razorpay_subscription_id);
    if (!row) throw new BillingError("not_found", 404);
    if (row.user_id !== session.user.id) throw new BillingError("owner_mismatch", 403);

    const event = await confirmRazorpayCheckout(
      cfg,
      { paymentId: body.data.razorpay_payment_id, subscriptionId: body.data.razorpay_subscription_id, signature: body.data.razorpay_signature },
      { userId: session.user.id, interval: row.interval, amountMinor: row.amount_minor, currency: row.currency },
    ).catch(async (e) => {
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
