import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for the few server-only jobs that cannot run as the signed-in person (removing a sign-in
 * identity, billing webhooks, support-attachment cleanup). It returns null unless SUPABASE_SERVICE_ROLE_KEY is set,
 * and the key is read only here, on the server. Nothing under src/components or src/lib imports this module, and a
 * test scans the browser bundle for the key name.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: "budgetbuddy" } });
}

/** Removing the sign-in identity is opt-in: FinTrack can share an auth project with other products, and deleting the identity would remove it for them too. */
export const deleteAuthUserEnabled = () => process.env.BUDGETBUDDY_DELETE_AUTH_USER === "true";
