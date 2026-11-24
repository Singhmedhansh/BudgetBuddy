import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/server/admin";
import { razorpayEventToBilling } from "@/server/payments/razorpay";
import { applyBillingEvent } from "@/server/payments/store";
import { verifyRazorpaySignature } from "@/server/payments/webhooks";

/**
 * Razorpay webhook. Until the secret and service key exist this answers 503 and changes nothing. After that it
 * verifies the signature on the raw body, then records the event through the database function that stores the event
 * id, applies the change and updates the plan in one transaction: a redelivery is a no-op, and a failure rolls
 * everything back so Razorpay's retry is processed. Events carry Razorpay's own timestamp, so a late event never
 * overwrites newer state.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const admin = createAdminClient();
  if (!secret || !admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const raw = await request.text();
  if (!verifyRazorpaySignature(raw, request.headers.get("x-razorpay-signature"), secret)) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });

  const eventId = request.headers.get("x-razorpay-event-id");
  if (!eventId) return NextResponse.json({ error: "missing_event_id" }, { status: 400 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const event = razorpayEventToBilling(body, eventId);
  if (!event) return NextResponse.json({ ok: true, ignored: true });
  try {
    const outcome = await applyBillingEvent(admin, event);
    return NextResponse.json(outcome === "duplicate" ? { ok: true, duplicate: true } : { ok: true, outcome });
  } catch {
    return NextResponse.json({ error: "processing_failed" }, { status: 500 }); // Razorpay retries
  }
}
