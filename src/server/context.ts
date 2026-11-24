import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Space, SpaceRole } from "./types";

export const ACTIVE_SPACE_COOKIE = "bb-space";
const RANK: Record<SpaceRole, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };
/** True when the role is at least `min`. Used to hide actions a person cannot perform; the database enforces the same rule. */
export const atLeast = (role: SpaceRole | null | undefined, min: SpaceRole) => !!role && RANK[role] >= RANK[min];

/**
 * Loads the signed-in user, their profile and active financial space once per
 * request. This is the server-side authentication check every protected page
 * relies on; the proxy redirect is only an optimistic convenience.
 */
export const getContext = cache(async () => {
  // Everything here is per-user, per-request. Opting out of prerendering up front
  // also stops Next's prefetch prerender tripping on clock reads (Date.now) below.
  await connection();
  const t0 = Date.now();
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const tAuth = Date.now() - t0;

  const wanted = (await cookies()).get(ACTIVE_SPACE_COOKIE)?.value;
  const { profile, spaces: list, space, role } = await buildContext(supabase, data.user.id, wanted);
  // Opt-in timing (PERF_LOG=1): durations only, never identifiers or data. Shows up in the host's function logs.
  if (process.env.PERF_LOG === "1") console.log(`[perf] getContext auth=${tAuth}ms total=${Date.now() - t0}ms`);
  return { supabase, user: data.user, profile, spaces: list, space, role };
});


type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/**
 * The person's profile, spaces and active space, read with a client that acts as them (so row-level security still
 * scopes every row). Used by the request context above and by background work that signs in as the person without a
 * browser (the weekly recap, WhatsApp).
 */
export async function buildContext(supabase: Db, userId: string, wantedSpaceId?: string) {
  // Three independent reads: run them together instead of one after another (each is a network round trip).
  // Membership rows are fetched for every space the person belongs to and the active one is picked locally,
  // which removes a fourth, dependent round trip. RLS still scopes every row to this user.
  const [profileRes, spacesRes, membersRes] = await Promise.all([
    supabase.rpc("ensure_profile"),
    supabase.from("financial_spaces").select("*").order("created_at"),
    supabase.from("financial_space_members").select("space_id,role").eq("user_id", userId),
  ]);
  const profileData = profileRes.data;
  const profile = (Array.isArray(profileData) ? profileData[0] : profileData) as Profile;
  const spaces = (spacesRes.data ?? []) as Space[];
  // The active space is the one the person chose, if they still belong to it; otherwise the first.
  const space = spaces.find((s) => s.id === wantedSpaceId) ?? spaces[0] ?? null;
  const role = space ? ((membersRes.data ?? []).find((m) => m.space_id === space.id)?.role as SpaceRole | undefined) ?? null : null;
  return { profile, spaces, space, role };
}

/** For pages that need a space; sends users who have not finished setup to onboarding. */
export async function requireSpace() {
  const ctx = await getContext();
  if (!ctx.space || !ctx.profile.onboarding_completed_at) redirect("/app/onboarding");
  return { ...ctx, space: ctx.space };
}
