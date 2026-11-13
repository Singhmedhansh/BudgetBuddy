import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/server/admin";
import { razorpayEventToUpdate, verifyRazorpaySignature } from "@/server/payments/webhooks";

/**
 * Razorpay webhook. Until the sandbox credentials are configured this answers 503 and changes nothing. Once they are,
 * it verifies the signature on the raw body, processes each event id once, and updates only the entitlement table.
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

  // Insert first: a duplicate event id violates the primary key and is acknowledged without being processed twice.
  const { error: dup } = await admin.from("payment_events").insert({ provider: "razorpay", event_id: eventId });
  if (dup) return NextResponse.json({ ok: true, duplicate: true });

  const update = razorpayEventToUpdate(body);
  if (update) {
    const { error } = await admin.from("entitlements").upsert({ user_id: update.userId, ...update.row, updated_at: new Date().toISOString() });
    if (error) {
      await admin.from("payment_events").delete().eq("provider", "razorpay").eq("event_id", eventId); // let Razorpay retry
      return NextResponse.json({ error: "processing_failed" }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
