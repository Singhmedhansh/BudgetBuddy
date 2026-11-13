import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/** OAuth (Google) return route: exchanges the code for a session. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  const supabase = await createClient();
  if (supabase && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await supabase.rpc("ensure_profile");
      return NextResponse.redirect(new URL(next, request.url));
    }
  }
  const dest = new URL("/login", request.url);
  dest.searchParams.set("error", "oauth");
  return NextResponse.redirect(dest);
}
