import { NextResponse, type NextRequest } from "next/server";
import { lastProviderOf, oauthReason, providerDisplayName, type OAuthReason } from "@/lib/auth/oauth-errors";
import { isSocialProvider } from "@/lib/auth/providers";
import { safeNext } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Return route for OAuth (Google, GitHub), magic links and identity linking. Exchanges the one-time code for a
 * session on the server, then sends the person on. Every failure ends on a page that says what to do; nothing from
 * the provider's error text is shown as it came.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const providerParam = searchParams.get("provider");
  const provider = isSocialProvider(providerParam) ? providerParam : null;
  // Linking is started from Settings; its failures go back there, everything else to the login page.
  const failurePath = next.startsWith("/app/settings") ? "/app/settings/connected" : "/login";
  const fail = (reason: OAuthReason) => {
    const dest = new URL(failurePath, request.url);
    dest.searchParams.set("error", reason);
    if (provider) dest.searchParams.set("provider", provider);
    return NextResponse.redirect(dest);
  };

  const providerError = searchParams.get("error") ?? searchParams.get("error_code");
  if (providerError) {
    return fail(oauthReason({ error: searchParams.get("error"), code: searchParams.get("error_code"), description: searchParams.get("error_description") }));
  }

  const code = searchParams.get("code");
  const supabase = await createClient();
  if (!supabase) return fail("unavailable");
  if (!code) return fail("expired");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail(oauthReason({ error: error?.message, code: error?.code }));

  const { data: profile } = await supabase.rpc("ensure_profile");
  const row = (Array.isArray(profile) ? profile[0] : profile) as { display_name?: string | null } | null;
  const offered = providerDisplayName(data.user);
  // First sign-in with a provider: pre-fill the name it gave us. A name the person already chose is never replaced.
  if (row && !row.display_name && offered) await supabase.from("profiles").update({ display_name: offered }).eq("user_id", data.user.id);
  const res = NextResponse.redirect(new URL(next, request.url));
  // A per-browser hint only: the provider name, never an email.
  res.cookies.set("bb-last-provider", lastProviderOf(data.user), { maxAge: 60 * 60 * 24 * 180, sameSite: "lax", path: "/", httpOnly: true });
  return res;
}
