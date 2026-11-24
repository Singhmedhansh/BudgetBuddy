/**
 * Sends one transactional email through Resend's HTTP API. Configured by RESEND_API_KEY and FINN_FROM_EMAIL (an address
 * on a domain verified in Resend, for example "Finn <finn@getfintrack.online>"). Without them nothing is sent and the
 * caller is told so; no message body or address is ever logged.
 */
export type EmailResult = "sent" | "not_configured" | "failed";

export const emailConfigured = () =>
  Boolean(process.env.RESEND_API_KEY && process.env.FINN_FROM_EMAIL);

export async function sendEmail(msg: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.FINN_FROM_EMAIL;
  if (!key || !from) return "not_configured";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
