/**
 * Only same-site, path-only redirect targets are allowed after sign-in. Anything
 * else (absolute URLs, protocol-relative "//host", backslash tricks, control
 * characters) falls back to the default, preventing open redirects.
 */
export function safeNext(raw: string | null | undefined, fallback = "/app"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(raw)) return fallback;
  return raw;
}
