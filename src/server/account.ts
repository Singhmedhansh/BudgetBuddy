import { createClient as createPlainClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Profile } from "./types";
import type { createClient } from "@/lib/supabase/server";

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** A short-lived signed link to the person's avatar in the private bucket, or null when there is none. */
export async function avatarUrl(supabase: Supabase, profile: Pick<Profile, "avatar_path">): Promise<string | null> {
  if (!profile.avatar_path) return null;
  const { data } = await supabase.storage.from("budgetbuddy-avatars").createSignedUrl(profile.avatar_path, 3600);
  return data?.signedUrl ?? null;
}

/** True when the account has a password sign-in (an email identity). OAuth-only accounts have none. */
export function hasPassword(user: Pick<User, "identities">): boolean {
  return (user.identities ?? []).some((i) => i.provider === "email");
}

/** True when the person signed in within the last `minutes`. Used to demand a fresh sign-in before risky actions. */
export function signedInWithin(user: Pick<User, "last_sign_in_at">, minutes: number, now = Date.now()): boolean {
  const t = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
  return now - t <= minutes * 60_000;
}

/**
 * Re-checks a password without touching the current session: a throwaway client that stores nothing. Supabase
 * applies its own rate limits to repeated wrong guesses. The password is never logged or returned.
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const env = getSupabaseEnv();
  if (!env || !email || !password) return false;
  const probe = createPlainClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (data.session) await probe.auth.signOut({ scope: "local" });
  return !error && Boolean(data.user);
}
