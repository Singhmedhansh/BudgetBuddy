import { createClient as createSupabase } from "@supabase/supabase-js";
import { DB_SCHEMA, getSupabaseEnv } from "@/lib/supabase/env";
import { createAdminClient } from "./admin";
import { buildContext } from "./context";

type Db = NonNullable<
  Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>
>;

/**
 * Server-only jobs that act for a person without their browser (the weekly recap, WhatsApp) need the same view of their
 * data as the app has: row-level security scoped to that one person, and the same code paths. This signs a short-lived
 * session in for them with a one-time token, so every query below it is limited by the database to their own rows,
 * exactly as in the app. It needs the service key, so it exists only where that key is set, and it is called only after
 * the caller has proved who the person is (a verified WhatsApp number, or a stored opt-in).
 */
export async function contextFor(userId: string) {
  const admin = createAdminClient();
  const env = getSupabaseEnv();
  if (!admin || !env) return null;
  try {
    const { data: found } = await admin.auth.admin.getUserById(userId);
    const email = found?.user?.email;
    if (!email) return null;
    const { data: link } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (!tokenHash) return null;
    const anon = createSupabase(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: DB_SCHEMA },
    });
    const { data: session, error } = await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    if (error || !session.user || session.user.id !== userId) return null;
    const supabase = anon as unknown as Db;
    const built = await buildContext(supabase, userId);
    if (!built.space || !built.profile?.onboarding_completed_at) return null;
    return { supabase, user: session.user, ...built, space: built.space };
  } catch {
    return null;
  }
}
