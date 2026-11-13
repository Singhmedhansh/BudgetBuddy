import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Space } from "./types";

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
  return { supabase, user: data.user, profile, spaces: list, space: list[0] ?? null };
});

/** For pages that need a space; sends users who have not finished setup to onboarding. */
export async function requireSpace() {
  const ctx = await getContext();
  if (!ctx.space || !ctx.profile.onboarding_completed_at) redirect("/app/onboarding");
  return { ...ctx, space: ctx.space };
}
