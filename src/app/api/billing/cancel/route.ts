import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/server/admin";
import { paypalConfig, razorpayConfig } from "@/server/payments/config";
import { billingFailure, currentUser, sameOrigin } from "@/server/payments/http";
import { cancelPaypalSubscription } from "@/server/payments/paypal";
import { cancelRazorpaySubscription } from "@/server/payments/razorpay";
import { applyBillingEvent, type SubscriptionRow } from "@/server/payments/store";
import { BillingError } from "@/server/payments/types";

/**
 * Cancels the signed-in person's own subscription. The paid period they already have runs to its end: Razorpay is
 * asked to stop at the end of the cycle, and for PayPal the stored paid-through date is kept. Nothing is refunded here.
 */
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) throw new BillingError("invalid_request", 403);
    const session = await currentUser();
    if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    const admin = createAdminClient();
    if (!admin) throw new BillingError("not_configured", 503);
    const { data } = await admin.from("billing_subscriptions").select("*").eq("user_id", session.user.id).in("status", ["active", "past_due"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const row = data as SubscriptionRow | null;
    if (!row) throw new BillingError("not_found", 404);
    const now = new Date();
    const base = { eventId: `cancel:${row.provider_subscription_id}:${now.getTime()}`, eventType: "user.cancel_requested", eventAt: now, userId: row.user_id, payment: null };
    if (row.provider === "razorpay") {
      const cfg = razorpayConfig();
      if (!cfg) throw new BillingError("not_configured", 503);
      await cancelRazorpaySubscription(cfg, row.provider_subscription_id);
      await applyBillingEvent(admin, { ...base, provider: "razorpay", subscription: { provider_subscription_id: row.provider_subscription_id, status: row.status, cancel_at_period_end: true, canceled_at: now.toISOString() } });
    } else {
      const cfg = paypalConfig();
      if (!cfg) throw new BillingError("not_configured", 503);
      await cancelPaypalSubscription(cfg, row.provider_subscription_id);
      await applyBillingEvent(admin, { ...base, provider: "paypal", subscription: { provider_subscription_id: row.provider_subscription_id, status: "canceled", cancel_at_period_end: true, canceled_at: now.toISOString() } });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return billingFailure(e);
  }
}
