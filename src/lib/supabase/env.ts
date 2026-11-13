/**
 * Supabase connection settings. FinTrack lives in its own `budgetbuddy`
 * Postgres schema, so every data client is created with that schema; Auth is
 * unaffected by it. Returns null when unconfigured so the UI can say so
 * plainly instead of throwing. Only public (browser-safe) values are read here;
 * the service-role key is never imported by anything under src/lib/supabase.
 *
 * Keeping the schema name and connection in this one module is what keeps
 * FinTrack portable to a dedicated Supabase project later: change the env
 * values, re-run the migrations, done.
 */
export const DB_SCHEMA = "budgetbuddy";

/**
 * FinTrack's own auth cookie name. Supabase's default name is derived from
 * the project ref, so two apps sharing one project (and one host in
 * development) would silently share a session. A distinct name keeps them
 * apart: a visitor signed in to another app is NOT signed in to FinTrack.
 */
export const AUTH_COOKIE_NAME = "sb-budgetbuddy-auth-token";

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
