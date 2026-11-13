import { createBrowserClient } from "@supabase/ssr";
import { AUTH_COOKIE_NAME, DB_SCHEMA, getSupabaseEnv } from "./env";

/** Browser Supabase client (anon key + the signed-in user's JWT; RLS applies). */
export function createClient() {
  const env = getSupabaseEnv();
  if (!env) return null;
  return createBrowserClient(env.url, env.anonKey, { db: { schema: DB_SCHEMA }, cookieOptions: { name: AUTH_COOKIE_NAME } });
}
