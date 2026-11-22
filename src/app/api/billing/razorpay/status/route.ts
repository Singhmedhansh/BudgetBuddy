import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/server/admin";
import { razorpayConfig } from "@/server/payments/config";
import { billingFailure, currentUser, sameOrigin } from "@/server/payments/http";
import { syncRazorpayOrder } from "@/server/payments/razorpay";
import { applyBillingEvent, type SubscriptionRow } from "@/server/payments/store";
import { BillingError } from "@/server/payments/types";

/**
 * "Did my payment go through?" for a person whose browser closed or lost connection before the confirmation step ran.
 * The server asks Razorpay about the person's own open order; if it was paid for exactly the expected amount, the same
 * ledger event the checkout step would have written is applied (once: it carries a fixed event id). It never trusts
 * anything the browser sends: there is no request body.
 */
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) throw new BillingError("invalid_request", 403);
    const session = await currentUser();
    if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });
    const cfg = razorpayConfig();
    const admin = createAdminClient();
    if (!cfg || !admin) throw new BillingError("not_configured", 503);
    const { data } = await admin.from("billing_subscriptions").select("*").eq("user_id", session.user.id).eq("provider", "razorpay").like("provider_subscription_id", "order_%").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const row = data as SubscriptionRow | null;
    if (!row) return NextResponse.json({ status: "none", paid: false });
    if (row.status === "active") return NextResponse.json({ status: "active", paid: true });
    const event = await syncRazorpayOrder(cfg, row);
    if (!event) return NextResponse.json({ status: "unpaid", paid: false });
    await applyBillingEvent(admin, event);
    return NextResponse.json({ status: event.subscription?.status === "active" ? "active" : "processing", paid: event.subscription?.status === "active" });
  } catch (e) {
    return billingFailure(e);
  }
}
