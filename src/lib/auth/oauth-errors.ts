import { SOCIAL_PROVIDERS } from "./providers";

/** Fixed reasons only. The callback puts one of these keys in the URL; pages look the sentence up, so a crafted link cannot show arbitrary text. */
export const OAUTH_REASONS = ["cancelled", "linked_elsewhere", "disabled", "unverified", "no_account", "rate_limited", "expired", "unavailable", "failed"] as const;
export type OAuthReason = (typeof OAUTH_REASONS)[number];
export const isOAuthReason = (v: unknown): v is OAuthReason => OAUTH_REASONS.includes(v as OAuthReason);

const label = (p: string | null | undefined) => SOCIAL_PROVIDERS.find((x) => x.id === p)?.label ?? "That provider";

/** Classifies what a provider or Supabase put on the callback URL. */
export function oauthReason(input: { error?: string | null; code?: string | null; description?: string | null }): OAuthReason {
  const text = `${input.code ?? ""} ${input.error ?? ""} ${input.description ?? ""}`.toLowerCase();
  if (/access_denied|cancel/.test(text)) return "cancelled";
  if (/identity_already_exists|already linked|already.*identity/.test(text)) return "linked_elsewhere";
  if (/provider is not enabled|unsupported provider|not enabled/.test(text)) return "disabled";
  if (/email.*(not\s+verified|unverified)|email_not_confirmed/.test(text)) return "unverified";
  if (/signup.*(disabled|not allowed)|user.*not.*found/.test(text)) return "no_account";
  if (/rate|too many|429/.test(text)) return "rate_limited";
  if (/expired|invalid.*(flow|code|state)|bad_oauth|code verifier|otp_expired/.test(text)) return "expired";
  return "failed";
}

export function oauthMessage(reason: string | null | undefined, provider?: string | null): string {
  const who = label(provider);
  switch (reason) {
    case "cancelled": return `You cancelled the ${who} sign-in. Try again when you are ready, or use your email.`;
    case "linked_elsewhere": return `That ${who} account is already connected to a different FinTrack account.`;
    case "disabled": return `${who} sign-in is not available right now. Use your email instead.`;
    case "unverified": return `${who} did not confirm your email address, so we cannot sign you in with it. Verify the email with ${who}, or use another way in.`;
    case "no_account": return "We could not find an account for that sign-in. Create an account first.";
    case "rate_limited": return "Too many attempts. Wait a few minutes before trying again.";
    case "expired": return "That sign-in link expired or was already used. Start again.";
    case "unavailable": return "Sign-in is not available right now. Please try again later.";
    default: return reason ? `${who} sign-in did not complete. Try again, or log in with your email.` : "";
  }
}

export function lastProviderOf(user: { app_metadata?: { provider?: string }; identities?: { provider: string; last_sign_in_at?: string }[] | null }): string {
  const ids = [...(user.identities ?? [])].sort((a, b) => String(b.last_sign_in_at ?? "").localeCompare(String(a.last_sign_in_at ?? "")));
  return ids[0]?.provider ?? user.app_metadata?.provider ?? "email";
}

/** A display name offered by the provider, trimmed and capped, or null. Only used to fill an empty profile name. */
export function providerDisplayName(user: { user_metadata?: Record<string, unknown> | null }): string | null {
  const m = user.user_metadata ?? {};
  const raw = [m.full_name, m.name, m.user_name].find((v) => typeof v === "string" && v.trim().length > 0) as string | undefined;
  return raw ? raw.trim().slice(0, 80) : null;
}
