import { NextResponse, type NextRequest } from "next/server";
import { canonicalHostRedirect } from "@/config/canonical-host";
import { updateSession } from "@/lib/supabase/session";

export function proxy(request: NextRequest) {
  const canonical = canonicalHostRedirect(request.nextUrl);
  if (canonical) return NextResponse.redirect(canonical, 308);
  return updateSession(request);
}

export const config = {
  // Skip static assets and images; run for pages and auth routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
