import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/server/admin";
import { paypalConfig, razorpayConfig } from "@/server/payments/config";
import { syncPaypalSubscription } from "@/server/payments/paypal";
import { reconcileRazorpaySubscription, syncRazorpayOrder } from "@/server/payments/razorpay";
import { applyBillingEvent, type SubscriptionRow } from "@/server/payments/store";

/**
 * Daily billing maintenance, called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`:
 *   1. moves subscriptions whose paid period has run out to past due / expired and re-derives the plan;
 *   2. re-reads every live subscription from its provider, so a missed or out-of-order webhook (a refund that arrived
 *      before its payment was recorded, a lost renewal) is repaired within a day.
 * Idempotent: one event id per subscription per day. Failures are counted, never thrown, and never carry provider text.
 */
export const maxDuration = 300;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const admin = createAdminClient();
  if (!secret || secret.length < 16 || !admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: swept, error } = await admin.rpc("billing_sweep_expired");
  if (error) return NextResponse.json({ error: "sweep_failed" }, { status: 500 });

  const day = new Date().toISOString().slice(0, 10);
  const { data } = await admin.from("billing_subscriptions").select("*").in("status", ["active", "past_due", "canceled"]).not("user_id", "is", null).order("updated_at", { ascending: true }).limit(200);
  const rz = razorpayConfig();
  const pp = paypalConfig();
  const out = { swept: Number(swept ?? 0), checked: 0, updated: 0, failed: 0 };
  for (const row of (data ?? []) as SubscriptionRow[]) {
    try {
      const eventId = `reconcile:${row.provider_subscription_id}:${day}`;
      const ev = row.provider === "paypal" ? (pp ? await syncPaypalSubscription(pp, row, { eventId, eventType: "reconcile" }) : null) : rz ? await reconcileRazorpaySubscription(rz, row, eventId) : null;
      if (!ev) continue;
      out.checked++;
      if ((await applyBillingEvent(admin, ev)) === "applied") out.updated++;
    } catch {
      out.failed++;
    }
  }
  // One-time Razorpay orders still waiting for a confirmation (closed tab, lost connection): ask Razorpay if they were paid.
  if (rz) {
    const { data: open } = await admin.from("billing_subscriptions").select("*").in("status", ["pending", "expired"]).eq("provider", "razorpay").like("provider_subscription_id", "order_%").not("user_id", "is", null).gte("created_at", new Date(Date.now() - 48 * 3_600_000).toISOString()).limit(200);
    for (const row of (open ?? []) as SubscriptionRow[]) {
      try {
        const ev = await syncRazorpayOrder(rz, row);
        if (!ev) continue;
        out.checked++;
        if ((await applyBillingEvent(admin, ev)) === "applied") out.updated++;
      } catch {
        out.failed++;
      }
    }
  }
  return NextResponse.json(out);
}
