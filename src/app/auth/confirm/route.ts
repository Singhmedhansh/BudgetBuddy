import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing route for links in confirmation and password-reset emails. Verifies
 * the one-time token server-side, establishes the session cookie, then sends
 * the user on. Invalid or expired links go to a page that explains and offers a
 * new link.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();
  if (supabase && tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      if (type !== "recovery") await supabase.rpc("ensure_profile");
      return NextResponse.redirect(new URL(type === "recovery" ? "/reset-password" : next, request.url));
    }
  }
  const dest = new URL("/auth/link-error", request.url);
  dest.searchParams.set("kind", type === "recovery" ? "reset" : "confirm");
  return NextResponse.redirect(dest);
}
