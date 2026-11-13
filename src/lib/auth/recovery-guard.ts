import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The password-reset action must only run for a session created by verifying a
 * reset link, never for an ordinary signed-in session. When the link is
 * verified, the confirm route sets a short-lived httpOnly cookie holding this
 * token; the action refuses to change a password without a valid one.
 */
export const RECOVERY_COOKIE = "bb-recovery";
export const RECOVERY_MAX_AGE_SECONDS = 15 * 60;

/**
 * The token is signed (HMAC-SHA256) so it cannot be forged by anyone who can set
 * a cookie in their own browser. Production requires RECOVERY_COOKIE_SECRET and
 * fails closed without it; development falls back to a fixed local value.
 */
export function recoverySecret(): string {
  const s = process.env.RECOVERY_COOKIE_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("RECOVERY_COOKIE_SECRET is not configured");
  return "development-only-recovery-secret";
}

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("hex");

export function makeRecoveryToken(userId: string, nowMs: number, secret: string = recoverySecret()): string {
  const payload = `${userId}.${nowMs}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function isRecoveryTokenValid(
  token: string | undefined,
  userId: string,
  nowMs: number,
  maxAgeSeconds = RECOVERY_MAX_AGE_SECONDS,
  secret: string = recoverySecret(),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [id, issuedRaw, mac] = parts;
  const expected = sign(`${id}.${issuedRaw}`, secret);
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const issued = Number(issuedRaw);
  if (id !== userId || !Number.isFinite(issued)) return false;
  const age = nowMs - issued;
  return age >= 0 && age <= maxAgeSeconds * 1000;
}

/** Same check against the current time. Server code calls this so render functions never touch the clock directly. */
export function isRecoveryTokenValidNow(token: string | undefined, userId: string): boolean {
  return isRecoveryTokenValid(token, userId, Date.now());
}
