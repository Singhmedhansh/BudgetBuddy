import { emailConfigured } from "@/server/email";
import { whatsappConfig } from "@/server/whatsapp/api";
import type { requireSpace } from "@/server/context";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

export interface FinnSettings {
  /** False until migration 16 is applied; the settings then say so instead of failing. */
  ready: boolean;
  weeklyRecap: boolean;
  /** Whether the server can send email at all (the recap is saved either way). */
  emailOn: boolean;
  whatsapp: {
    /** The FinTrack WhatsApp number people message, digits only, or null while it is not set up. */
    number: string | null;
    phone: string | null;
    verified: boolean;
    pendingCodeUntil: string | null;
  };
}

/** What the person has chosen for the recap and WhatsApp. Any read that fails leaves the settings switched off. */
export async function loadFinnSettings(ctx: Ctx): Promise<FinnSettings> {
  const off: FinnSettings = {
    ready: false,
    weeklyRecap: false,
    emailOn: emailConfigured(),
    whatsapp: {
      number: whatsappConfig()?.number ?? null,
      phone: null,
      verified: false,
      pendingCodeUntil: null,
    },
  };
  try {
    const [prefs, link] = await Promise.all([
      ctx.supabase.from("finn_prefs").select("weekly_recap").maybeSingle(),
      ctx.supabase
        .from("whatsapp_links")
        .select("phone,verified_at,code_expires_at")
        .maybeSingle(),
    ]);
    if (prefs.error || link.error) return off;
    const l = link.data as {
      phone: string;
      verified_at: string | null;
      code_expires_at: string | null;
    } | null;
    return {
      ...off,
      ready: true,
      weeklyRecap: Boolean(
        (prefs.data as { weekly_recap: boolean } | null)?.weekly_recap,
      ),
      whatsapp: {
        ...off.whatsapp,
        phone: l?.phone ?? null,
        verified: Boolean(l?.verified_at),
        pendingCodeUntil:
          l && !l.verified_at && l.code_expires_at ? l.code_expires_at : null,
      },
    };
  } catch {
    return off;
  }
}
