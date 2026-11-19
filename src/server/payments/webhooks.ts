import { createHmac, timingSafeEqual } from "node:crypto";

/** Razorpay signs the raw request body with HMAC-SHA256 using the webhook secret (hex). Compared in constant time. */
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}
