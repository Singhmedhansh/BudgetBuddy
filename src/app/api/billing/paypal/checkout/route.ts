import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BRAND } from "@/config/brand";
import { createAdminClient } from "@/server/admin";
import { paypalConfig } from "@/server/payments/config";
import { billingFailure, currentUser, INTERVALS, sameOrigin } from "@/server/payments/http";
import { createPaypalSubscription, getPaypalSubscription } from "@/server/payments/paypal";
import { insertPending, reservePending } from "@/server/payments/store";
import { BillingError } from "@/server/payments/types";
import { siteUrl } from "@/server/site-url";

/**
 * Step 1 of paying with PayPal. Creates the subscription on the server and returns PayPal's own approval address.
 * Approval alone grants nothing: access is decided later, from PayPal's record, in the return route and the webhook.
 */
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) throw new BillingError("invalid_request", 403);
    const session = await currentUser();
    if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    const cfg = paypalConfig();
    const admin = createAdminClient();
    if (!cfg || !admin) throw new BillingError("not_configured", 503);
    const body = z.object({ interval: z.enum(INTERVALS) }).safeParse(await request.json().catch(() => null));
    if (!body.success) throw new BillingError("invalid_request");
    const { interval } = body.data;
    if (!cfg.planIds[interval]) throw new BillingError("interval_unavailable");

    const { existing } = await reservePending(admin, { userId: session.user.id, provider: "paypal", interval });
    if (existing) {
      // Reuse an approval that has not been completed; otherwise retire it and start fresh.
      const live = await getPaypalSubscription(cfg, existing.provider_subscription_id).catch(() => null);
      const approve = live?.status === "APPROVAL_PENDING" ? live.links?.find((l) => l.rel === "approve")?.href : undefined;
      if (approve) return NextResponse.json({ approveUrl: approve, testMode: cfg.mode === "sandbox" });
      await admin.from("billing_subscriptions").update({ status: "expired" }).eq("id", existing.id);
    }
    const origin = await siteUrl();
    const created = await createPaypalSubscription(cfg, interval, session.user.id, { returnUrl: `${origin}/api/billing/paypal/return`, cancelUrl: `${origin}/app/settings/billing?checkout=cancelled`, brand: BRAND.name });
    await insertPending(admin, { userId: session.user.id, provider: "paypal", providerSubscriptionId: created.id, interval, amountMinor: created.amountMinor, currency: created.currency });
    return NextResponse.json({ approveUrl: created.approveUrl, testMode: cfg.mode === "sandbox" });
  } catch (e) {
    return billingFailure(e);
  }
}
