"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/app/AccountMenu";
import { createClient } from "@/lib/supabase/client";

export interface SignedIn {
  name: string;
}

/**
 * Who is signed in, read in the browser so the public pages stay static. The session comes from the auth cookie
 * (no network call); the display name is one row read under RLS. Null while unknown or signed out.
 */
export function useSignedIn(): SignedIn | null {
  const [who, setWho] = useState<SignedIn | null>(null);
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let live = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user || !live) return;
      const fallback = (user.user_metadata?.full_name as string | undefined) || user.email || "Account";
      setWho({ name: fallback });
      const { data: row } = await supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle();
      if (live && row?.display_name) setWho({ name: row.display_name });
    })().catch(() => {});
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (live && !session) setWho(null);
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return who;
}

/** Desktop header: the profile pill that takes a signed-in person back to the app. */
export function HeaderAccountPill({ who }: { who: SignedIn }) {
  return (
    <Link
      href="/app"
      aria-label={`Open FinTrack, signed in as ${who.name}`}
      className="group hidden h-10 items-center gap-2 rounded-full border border-line-strong bg-surface py-1 pl-1 pr-3 text-sm font-medium transition-colors hover:border-primary sm:flex"
    >
      <Avatar name={who.name} url={null} size={30} />
      <span className="max-w-[9rem] truncate">{who.name}</span>
      <span className="flex items-center gap-1 border-l border-line pl-2 text-primary">
        Open app
        <ArrowRight size={14} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
