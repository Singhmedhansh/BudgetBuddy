/**
 * Password rules and strength feedback. The minimum is enforced on the server
 * too; the strength meter only guides the user. Strength is heuristic: it does
 * not replace the breach check (Supabase leaked-password protection).
 */
export const MIN_PASSWORD_LENGTH = 10;

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; hint: string };

const COMMON = new Set(["password", "password1", "12345678", "123456789", "1234567890", "qwertyuiop", "iloveyou", "welcome1", "admin123"]);

export function passwordProblems(pw: string): string[] {
  const out: string[] = [];
  if (pw.length < MIN_PASSWORD_LENGTH) out.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (COMMON.has(pw.toLowerCase())) out.push("That password is too common.");
  return out;
}

export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: "", hint: "" };
  if (passwordProblems(pw).length) {
    return { score: pw.length < 6 ? 0 : 1, label: "Weak", hint: passwordProblems(pw)[0] };
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const long = pw.length >= 14;
  const score = Math.min(4, 1 + (classes >= 3 ? 1 : 0) + (long ? 1 : 0) + (classes === 4 && long ? 1 : 0)) as 1 | 2 | 3 | 4;
  const labels = ["", "Fair", "Good", "Strong", "Very strong"] as const;
  return { score, label: labels[score], hint: score < 3 ? "Add length or mix letters, numbers and symbols." : "" };
}
