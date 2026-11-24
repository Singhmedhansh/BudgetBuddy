import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { makeRecoveryToken, RECOVERY_COOKIE, RECOVERY_MAX_AGE_SECONDS } from "@/lib/auth/recovery-guard";
import { safeNext } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import { claimTries, TRY_COOKIE, writeTryCookie } from "@/server/ai/finn-try";

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
      if (type !== "recovery") {
        await supabase.rpc("ensure_profile");
        const res = NextResponse.redirect(new URL(next, request.url));
        // Messages tried on the home page before signing up count towards this account's Finn allowance.
        const claimed = await claimTries(supabase, request.cookies.get(TRY_COOKIE)?.value).catch(() => null);
        const tryCookie = claimed ? writeTryCookie(claimed) : null;
        if (tryCookie) res.cookies.set(tryCookie.name, tryCookie.value, tryCookie.options);
        return res;
      }
      // Mark this session as arriving through a verified reset link. The reset
      // action refuses to change a password without this short-lived cookie.
      const { data } = await supabase.auth.getUser();
      const res = NextResponse.redirect(new URL("/reset-password", request.url));
      if (data.user) {
        res.cookies.set(RECOVERY_COOKIE, makeRecoveryToken(data.user.id, Date.now()), {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: process.env.NODE_ENV === "production",
          maxAge: RECOVERY_MAX_AGE_SECONDS,
        });
      }
      return res;
    }
  }
  const dest = new URL("/auth/link-error", request.url);
  dest.searchParams.set("kind", type === "recovery" ? "reset" : "confirm");
  return NextResponse.redirect(dest);
}
