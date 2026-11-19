import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/server/admin";
import { paypalConfig } from "@/server/payments/config";
import { paypalEventSaleId, paypalEventSubscriptionId, syncPaypalSubscription, verifyPaypalWebhook } from "@/server/payments/paypal";
import { applyBillingEvent, audit, findSubscription, subscriptionForPayment } from "@/server/payments/store";
import { BillingError } from "@/server/payments/types";

/**
 * PayPal webhook. PayPal itself verifies the delivery's signature (verify-webhook-signature) before anything is read.
 * The event only says which subscription changed; what is recorded is the subscription as PayPal reports it now,
 * checked against the price on record. Each event id is recorded once, so a redelivery changes nothing, and because
 * state is re-read rather than copied from the event, events arriving out of order still converge on the truth.
 */
export async function POST(request: NextRequest) {
  const cfg = paypalConfig();
  const admin = createAdminClient();
  if (!cfg?.webhookId || !admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const raw = await request.text();
  let event: { id?: string; event_type?: string };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!(await verifyPaypalWebhook(cfg, request.headers, event))) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  if (!event.id || !event.event_type) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  try {
    const subId = paypalEventSubscriptionId(event);
    // Refunds and reversals name the original sale, not the subscription: find it through the payment ledger.
    const saleId = paypalEventSaleId(event);
    const row = subId ? await findSubscription(admin, "paypal", subId) : saleId ? await subscriptionForPayment(admin, "paypal", saleId) : null;
    if (!row || !row.user_id) {
      // Not one of ours, or a refund for a payment not recorded yet: store the id so a redelivery is a no-op and
      // change nothing else. The daily reconcile (/api/cron/billing) re-reads PayPal and picks up anything missed.
      await applyBillingEvent(admin, { provider: "paypal", eventId: event.id, eventType: event.event_type, eventAt: new Date(), userId: null, subscription: null, payment: null });
      return NextResponse.json({ ok: true });
    }
    const ev = await syncPaypalSubscription(cfg, row, { eventId: event.id, eventType: event.event_type });
    return NextResponse.json({ ok: true, outcome: await applyBillingEvent(admin, ev) });
  } catch (e) {
    if (e instanceof BillingError && ["amount_mismatch", "plan_mismatch", "owner_mismatch"].includes(e.code)) {
      // A real but inconsistent subscription: record it for a human, acknowledge so PayPal does not retry forever.
      await audit(admin, { userId: null, provider: "paypal", actor: "webhook", action: "webhook_rejected", detail: { event_id: event.id, reason: e.code } });
      return NextResponse.json({ ok: true, rejected: e.code });
    }
    return NextResponse.json({ error: "processing_failed" }, { status: 500 }); // PayPal retries
  }
}
