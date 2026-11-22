/**
 * Who may open the Finn review queue and receives the weekly note: the addresses in FINN_REVIEWERS (comma separated).
 * Empty or unset means nobody, so the queue stays closed by default.
 */
export function reviewerEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.FINN_REVIEWERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

export function isReviewer(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(email) && reviewerEmails(env).includes(email!.toLowerCase());
}
