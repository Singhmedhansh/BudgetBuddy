import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BRAND } from "@/config/brand";
import { createAdminClient } from "@/server/admin";
import { razorpayConfig } from "@/server/payments/config";
import { billingFailure, currentUser, INTERVALS, sameOrigin } from "@/server/payments/http";
import { createRazorpaySubscription, expectedRazorpayPrice } from "@/server/payments/razorpay";
import { insertPending, reservePending } from "@/server/payments/store";
import { BillingError } from "@/server/payments/types";

/**
 * Step 1 of paying with Razorpay. Creates the Razorpay subscription on the server and returns only what Checkout
 * needs: the public key id and the subscription id. The price is never accepted from the browser.
 */
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) throw new BillingError("invalid_request", 403);
    const session = await currentUser();
    if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    const cfg = razorpayConfig();
    const admin = createAdminClient();
    if (!cfg || !admin) throw new BillingError("not_configured", 503);
    const body = z.object({ interval: z.enum(INTERVALS) }).safeParse(await request.json().catch(() => null));
    if (!body.success) throw new BillingError("invalid_request");
    const { interval } = body.data;
    if (!cfg.planIds[interval]) throw new BillingError("interval_unavailable");

    const { existing } = await reservePending(admin, { userId: session.user.id, provider: "razorpay", interval });
    let subscriptionId = existing?.provider_subscription_id;
    if (!subscriptionId) {
      const created = await createRazorpaySubscription(cfg, interval, session.user.id);
      await insertPending(admin, { userId: session.user.id, provider: "razorpay", providerSubscriptionId: created.id, interval, amountMinor: created.amountMinor, currency: created.currency });
      subscriptionId = created.id;
    }
    const price = expectedRazorpayPrice(interval);
    return NextResponse.json({ keyId: cfg.keyId, subscriptionId, name: BRAND.name, description: `FinTrack One, billed ${interval === "month" ? "monthly" : "yearly"}`, amountMinor: price.amountMinor, currency: price.currency, email: session.user.email ?? "", testMode: cfg.mode === "sandbox" });
  } catch (e) {
    return billingFailure(e);
  }
}
