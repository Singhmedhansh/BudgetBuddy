import { getSupabaseEnv } from "@/lib/supabase/env";

export type SocialProvider = "google" | "github";
export const SOCIAL_PROVIDERS: { id: SocialProvider; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
];
export const isSocialProvider = (v: unknown): v is SocialProvider => v === "google" || v === "github";

export interface EnabledProviders {
  social: SocialProvider[];
  email: boolean;
}

/** Reads the provider flags from Supabase's public `/auth/v1/settings` payload. Anything unclear is treated as off. */
export function parseProviders(settings: unknown): EnabledProviders {
  const ext = (settings as { external?: Record<string, unknown> } | null)?.external ?? {};
  return {
    social: SOCIAL_PROVIDERS.filter((p) => ext[p.id] === true).map((p) => p.id),
    email: ext.email !== false,
  };
}

/**
 * Which sign-in methods are really enabled in the Supabase project. The login and signup pages show a social
 * button only when this says the provider is configured, so there is never a button that cannot work. If the
 * settings cannot be read, social sign-in is hidden and email/password keeps working.
 */
export async function getEnabledProviders(): Promise<EnabledProviders> {
  const env = getSupabaseEnv();
  if (!env) return { social: [], email: false };
  try {
    const res = await fetch(`${env.url}/auth/v1/settings`, { headers: { apikey: env.anonKey }, next: { revalidate: 300 }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { social: [], email: true };
    return parseProviders(await res.json());
  } catch {
    return { social: [], email: true };
  }
}
