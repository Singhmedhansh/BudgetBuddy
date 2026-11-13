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
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: profileData } = await supabase.rpc("ensure_profile");
  const profile = (Array.isArray(profileData) ? profileData[0] : profileData) as Profile;

  const { data: spaces } = await supabase.from("financial_spaces").select("id,name,kind,currency").order("created_at");
  const list = (spaces ?? []) as Space[];
  // The active space is the one the person chose, if they still belong to it; otherwise the first.
  const wanted = (await cookies()).get(ACTIVE_SPACE_COOKIE)?.value;
  const space = list.find((s) => s.id === wanted) ?? list[0] ?? null;
  let role: SpaceRole | null = null;
  if (space) {
    const { data: m } = await supabase.from("financial_space_members").select("role").eq("space_id", space.id).eq("user_id", data.user.id).maybeSingle();
    role = (m?.role as SpaceRole | undefined) ?? null;
  }
  return { supabase, user: data.user, profile, spaces: list, space, role };
});

/** For pages that need a space; sends users who have not finished setup to onboarding. */
export async function requireSpace() {
  const ctx = await getContext();
  if (!ctx.space || !ctx.profile.onboarding_completed_at) redirect("/app/onboarding");
  return { ...ctx, space: ctx.space };
}
