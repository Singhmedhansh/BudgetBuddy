import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BILLING_MESSAGES, BillingError } from "./types";

/**
 * Cookie-authenticated JSON routes must come from this site. Browsers always send Origin on cross-site POSTs, so a
 * request with a foreign (or missing, for a POST that carries cookies) Origin is refused. SameSite cookies are the
 * first defence; this is the second.
 */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return o.host === host;
  } catch {
    return false;
  }
}

export async function currentUser() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ? { user: data.user, supabase } : null;
}

/** A failure as a response. Only the plain sentence for the code leaves the server: no provider text, no ids, no keys. */
export function billingFailure(e: unknown): NextResponse {
  if (e instanceof BillingError) return NextResponse.json({ error: e.code, message: BILLING_MESSAGES[e.code] }, { status: e.status });
  return NextResponse.json({ error: "provider_error", message: BILLING_MESSAGES.provider_error }, { status: 500 });
}

export const INTERVALS = ["month", "year"] as const;
