import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/server/admin";
import { paypalConfig } from "@/server/payments/config";
import { currentUser } from "@/server/payments/http";
import { getPaypalSubscription, paypalStateToBilling } from "@/server/payments/paypal";
import { applyBillingEvent, audit, findSubscription } from "@/server/payments/store";
import { BillingError } from "@/server/payments/types";

/**
 * Where PayPal sends the customer after approval. The address is a convenience, not proof: the subscription id in
 * the query string is only a pointer. The server reads the subscription from PayPal, requires it to belong to the
 * signed-in person and to the plan and price on record, and only then records it.
 */
export async function GET(request: NextRequest) {
  const done = (state: string) => NextResponse.redirect(new URL(`/app/settings/billing?checkout=${state}`, request.nextUrl.origin));
  const id = request.nextUrl.searchParams.get("subscription_id") ?? "";
  if (!/^I-[A-Z0-9]+$/.test(id)) return done("failed");
  const session = await currentUser();
  if (!session) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/app/settings/billing")}`, request.nextUrl.origin));
  const cfg = paypalConfig();
  const admin = createAdminClient();
  if (!cfg || !admin) return done("failed");
  try {
    const row = await findSubscription(admin, "paypal", id);
    if (!row || row.user_id !== session.user.id) return done("failed");
    const live = await getPaypalSubscription(cfg, id);
    const planId = cfg.planIds[row.interval];
    if (!planId) return done("failed");
    const event = paypalStateToBilling(live, { userId: session.user.id, planId, amountMinor: row.amount_minor, currency: row.currency }, { eventId: `return:${id}:${live.status}:${live.billing_info?.last_payment?.time ?? "none"}`, eventType: "checkout.returned" });
    await applyBillingEvent(admin, event);
    return done(event.subscription?.status === "active" ? "success" : event.subscription?.status === "pending" ? "pending" : "failed");
  } catch (e) {
    if (e instanceof BillingError && e.code !== "provider_error") await audit(admin, { userId: session.user.id, provider: "paypal", actor: "checkout", action: "verification_failed", detail: { reason: e.code, subscription: id } });
    return done("failed");
  }
}
