import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { allowAddress, demoReply, FINN_TRIES, readTryCookie, TRY_COOKIE, writeTryCookie } from "@/server/ai/finn-try";
import { sameOrigin } from "@/server/payments/http";
import { createClient } from "@/lib/supabase/server";

/**
 * Try Finn from the home page, without an account: FINN_TRIES messages per browser, then the visitor is asked to sign up.
 * Nothing is saved. Signed-in people are sent to Finn in the app instead, where their own records are used.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "invalid_request" }, { status: 403 });
  const body = z.object({ message: z.string().trim().min(1).max(300) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_request", message: "Type a message of up to 300 characters." }, { status: 400 });

  const supabase = await createClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (data.user) return NextResponse.json({ signedIn: true });

  const state = readTryCookie(request.cookies.get(TRY_COOKIE)?.value);
  if (state.used >= FINN_TRIES) return NextResponse.json({ limit: true, left: 0 });
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allowAddress(ip)) return NextResponse.json({ limit: true, left: 0 });

  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000); // the home page speaks to India first; the date only labels "Today"
  const reply = await demoReply(body.data.message, { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1, day: ist.getUTCDate() });
  if (reply.kind === "unavailable") return NextResponse.json({ unavailable: true, left: FINN_TRIES - state.used });

  const next = { used: state.used + 1, claimed: state.claimed };
  const res = NextResponse.json({ reply, left: FINN_TRIES - next.used });
  const cookie = writeTryCookie(next);
  if (cookie) res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
