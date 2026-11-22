import { after, NextResponse, type NextRequest } from "next/server";
import {
  parseIncoming,
  verifySignature,
  whatsappConfig,
} from "@/server/whatsapp/api";
import { handleIncoming } from "@/server/whatsapp/handler";

/**
 * WhatsApp Business Cloud API webhook.
 *   GET   Meta's one-time check that this address is yours (hub.verify_token).
 *   POST  incoming messages. The body is accepted only if its signature matches the app secret; the work is done after
 *         the 200 is returned, because Meta resends anything not acknowledged within a few seconds.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cfg = whatsappConfig();
  const p = request.nextUrl.searchParams;
  if (
    cfg &&
    p.get("hub.mode") === "subscribe" &&
    p.get("hub.verify_token") === cfg.verifyToken
  )
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const cfg = whatsappConfig();
  if (!cfg)
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await request.text();
  if (
    !verifySignature(
      raw,
      request.headers.get("x-hub-signature-256"),
      cfg.appSecret,
    )
  )
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const messages = parseIncoming(payload);
  after(async () => {
    for (const m of messages) {
      try {
        await handleIncoming(m);
      } catch {
        /* one bad message must not stop the rest */
      }
    }
  });
  return NextResponse.json({ ok: true });
}
