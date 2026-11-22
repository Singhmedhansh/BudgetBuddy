import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Business Cloud API (Meta). Configured by:
 *   WHATSAPP_VERIFY_TOKEN       a string you choose, typed into Meta's webhook setup
 *   WHATSAPP_APP_SECRET         the app secret, used to check every delivery really came from Meta
 *   WHATSAPP_TOKEN              a permanent access token for the business number
 *   WHATSAPP_PHONE_NUMBER_ID    the id of the business number (not the number itself)
 *   WHATSAPP_NUMBER             the business number people message, digits only (shown in the app)
 * Without all five the feature stays off and the app says so.
 */
export function whatsappConfig() {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const number = process.env.WHATSAPP_NUMBER?.replace(/\D/g, "");
  if (!verifyToken || !appSecret || !token || !phoneNumberId || !number)
    return null;
  return { verifyToken, appSecret, token, phoneNumberId, number };
}

/** Meta signs the raw body with the app secret; anything that does not match is ignored. */
export function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface Incoming {
  /** WhatsApp's id for the message, used so a redelivery is not acted on twice. */
  id: string;
  /** The sender's number, digits only, no plus. */
  from: string;
  text: string;
}

/** The text messages in a webhook delivery. Anything else (images, statuses, reactions) is skipped. */
export function parseIncoming(payload: unknown): Incoming[] {
  const out: Incoming[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries)
    for (const c of (e as { changes?: unknown[] })?.changes ?? []) {
      const msgs = (
        c as {
          value?: {
            messages?: {
              id?: string;
              from?: string;
              type?: string;
              text?: { body?: string };
            }[];
          };
        }
      )?.value?.messages;
      for (const m of msgs ?? [])
        if (m.type === "text" && m.id && m.from && m.text?.body)
          out.push({
            id: String(m.id),
            from: String(m.from).replace(/\D/g, ""),
            text: String(m.text.body).slice(0, 1000),
          });
    }
  return out;
}

export async function sendWhatsApp(to: string, body: string): Promise<boolean> {
  const cfg = whatsappConfig();
  if (!cfg) return false;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: body.slice(0, 3500), preview_url: false },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
