"use server";

import { revalidatePath } from "next/cache";
import { requireSpace } from "@/server/context";

export async function setWeeklyRecapAction(
  on: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const ctx = await requireSpace();
  const now = new Date().toISOString();
  // Update first; insert only when the person has no row yet (the table grants column-level writes).
  const { data, error } = await ctx.supabase
    .from("finn_prefs")
    .update({ weekly_recap: on, updated_at: now })
    .eq("user_id", ctx.user.id)
    .select("user_id");
  if (error)
    return { ok: false, message: "That setting is not available yet." };
  if (!data?.length) {
    const ins = await ctx.supabase
      .from("finn_prefs")
      .insert({ user_id: ctx.user.id, weekly_recap: on });
    if (ins.error)
      return { ok: false, message: "That setting could not be saved." };
  }
  revalidatePath("/app/assistant");
  return { ok: true };
}

/** Quick records ("400 on food") saved at once with an Undo, instead of a card to confirm. */
export async function setAutoSaveLogsAction(
  on: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const ctx = await requireSpace();
  const { data, error } = await ctx.supabase
    .from("finn_prefs")
    .update({ auto_save_logs: on, updated_at: new Date().toISOString() })
    .eq("user_id", ctx.user.id)
    .select("user_id");
  if (error)
    return { ok: false, message: "That setting is not available yet." };
  if (!data?.length) {
    const ins = await ctx.supabase
      .from("finn_prefs")
      .insert({ user_id: ctx.user.id, auto_save_logs: on });
    if (ins.error)
      return { ok: false, message: "That setting could not be saved." };
  }
  revalidatePath("/app/assistant");
  return { ok: true };
}

export async function startWhatsAppLinkAction(
  phone: string,
): Promise<
  { ok: true; code: string; expiresAt: string } | { ok: false; message: string }
> {
  const ctx = await requireSpace();
  const p = "+" + phone.replace(/[^\d]/g, "");
  const { data, error } = await ctx.supabase.rpc("finn_whatsapp_start", {
    p_phone: p,
  });
  if (error)
    return {
      ok: false,
      message: /country code|already linked/i.test(error.message)
        ? error.message
        : "That number could not be linked. Check it and try again.",
    };
  const r = data as { code: string; expires_at: string };
  revalidatePath("/app/assistant");
  return { ok: true, code: r.code, expiresAt: r.expires_at };
}

export async function unlinkWhatsAppAction(): Promise<void> {
  const ctx = await requireSpace();
  await ctx.supabase.from("whatsapp_links").delete().eq("user_id", ctx.user.id);
  revalidatePath("/app/assistant");
}
