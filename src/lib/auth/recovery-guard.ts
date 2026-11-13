/**
 * The password-reset action must only run for a session created by verifying a
 * reset link, never for an ordinary signed-in session. When the link is
 * verified, the confirm route sets a short-lived httpOnly cookie holding this
 * token; the action refuses to change a password without a valid one.
 */
export const RECOVERY_COOKIE = "bb-recovery";
export const RECOVERY_MAX_AGE_SECONDS = 15 * 60;

export function makeRecoveryToken(userId: string, nowMs: number): string {
  return `${userId}.${nowMs}`;
}

export function isRecoveryTokenValid(
  token: string | undefined,
  userId: string,
  nowMs: number,
  maxAgeSeconds = RECOVERY_MAX_AGE_SECONDS,
): boolean {
  if (!token) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const id = token.slice(0, i);
  const issued = Number(token.slice(i + 1));
  if (id !== userId || !Number.isFinite(issued)) return false;
  const age = nowMs - issued;
  return age >= 0 && age <= maxAgeSeconds * 1000;
}
