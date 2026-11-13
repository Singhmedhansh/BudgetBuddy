import { createHmac, timingSafeEqual } from "node:crypto";
import type { EntitlementRow } from "./entitlements";

/** Razorpay signs the raw request body with HMAC-SHA256 using the webhook secret (hex). Compared in constant time. */
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface EntitlementUpdate {
  /** FinTrack user id, carried in the subscription's notes when checkout is created. */
  userId: string;
  row: Pick<EntitlementRow, "plan" | "status" | "current_period_end"> & { provider: "razorpay"; provider_ref: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Turns a Razorpay subscription event into an entitlement change, or null for events that change nothing. */
export function razorpayEventToUpdate(event: unknown): EntitlementUpdate | null {
  const e = event as { event?: string; payload?: { subscription?: { entity?: { id?: string; status?: string; current_end?: number | null; notes?: { user_id?: string } } } } };
  const sub = e?.payload?.subscription?.entity;
  const userId = sub?.notes?.user_id;
  if (!sub?.id || !userId || !UUID.test(userId)) return null;
  const end = typeof sub.current_end === "number" ? new Date(sub.current_end * 1000).toISOString() : null;
  const status = { "subscription.activated": "active", "subscription.charged": "active", "subscription.pending": "past_due", "subscription.halted": "past_due", "subscription.cancelled": "canceled", "subscription.completed": "canceled" }[e.event ?? ""] as EntitlementRow["status"] | undefined;
  if (!status) return null;
  return { userId, row: { plan: "pro", status, current_period_end: end, provider: "razorpay", provider_ref: sub.id } };
}
