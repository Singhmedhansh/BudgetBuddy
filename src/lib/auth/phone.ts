/**
 * Turns what a person typed into an E.164 number (+919876543210), or null when it cannot be a real number.
 * A bare 10-digit Indian mobile number (starts 6 to 9, optionally with a leading 0) gets +91, because that is who
 * this is built for; every other number needs its own country code.
 */
export function normalizePhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (/^0?[6-9]\d{9}$/.test(s)) s = "+91" + s.replace(/^0/, "");
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** Shows enough to recognise the number, never all of it: "+91••••••210". */
export function maskPhone(e164: string): string {
  return e164.slice(0, 3) + "•".repeat(Math.max(0, e164.length - 6)) + e164.slice(-3);
}
