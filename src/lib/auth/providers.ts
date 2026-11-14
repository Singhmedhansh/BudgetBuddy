import { getSupabaseEnv } from "@/lib/supabase/env";

export type SocialProvider = "google" | "apple" | "x" | "github";
/** In the order they are shown. `x` is Supabase's id for "X / Twitter (OAuth 2.0)"; the deprecated `twitter` provider is not used. */
export const SOCIAL_PROVIDERS: { id: SocialProvider; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "apple", label: "Apple" },
  { id: "x", label: "X" },
  { id: "github", label: "GitHub" },
];
export const isSocialProvider = (v: unknown): v is SocialProvider => SOCIAL_PROVIDERS.some((p) => p.id === v);

export interface EnabledProviders {
  social: SocialProvider[];
  email: boolean;
  /** Phone sign-in with a one-time code by SMS. Needs an SMS provider configured in Supabase. */
  phone: boolean;
}

/** Reads the provider flags from Supabase's public `/auth/v1/settings` payload. Anything unclear is treated as off. */
export function parseProviders(settings: unknown): EnabledProviders {
  const ext = (settings as { external?: Record<string, unknown> } | null)?.external ?? {};
  return {
    social: SOCIAL_PROVIDERS.filter((p) => ext[p.id] === true).map((p) => p.id),
    email: ext.email !== false,
    phone: ext.phone === true,
  };
}

/**
 * Which sign-in methods are really enabled in the Supabase project. The login and signup pages show a social
 * button only when this says the provider is configured, so there is never a button that cannot work. If the
 * settings cannot be read, social sign-in is hidden and email/password keeps working.
 */
export async function getEnabledProviders(): Promise<EnabledProviders> {
  const env = getSupabaseEnv();
  if (!env) return { social: [], email: false, phone: false };
  try {
    const res = await fetch(`${env.url}/auth/v1/settings`, { headers: { apikey: env.anonKey }, next: { revalidate: 300 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { social: [], email: true, phone: false };
    return parseProviders(await res.json());
  } catch {
    return { social: [], email: true, phone: false };
  }
}
