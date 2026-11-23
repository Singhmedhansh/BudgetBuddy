import { createAdminClient } from "@/server/admin";
import { databaseAnswerCache } from "@/server/ai/answer-cache";
import { ask, MESSAGES } from "@/server/ai/assistant";
import { loadFacts } from "@/server/ai/facts";
import { executeFinnAction } from "@/server/ai/finn-execute";
import { proposeAction } from "@/server/ai/finn-actions";
import { planLimitsFor } from "@/server/ai/session";
import { usageStoreFor } from "@/server/ai/usage-store";
import type { FinnAction } from "@/server/ai/visuals";
import { contextFor } from "@/server/impersonate";
import { sendWhatsApp, type Incoming } from "./api";
import {
  describeAction,
  forWhatsApp,
  parseConfirm,
  parseLinkCode,
} from "./text";

const HELP =
  "I'm Finn, your FinTrack money assistant. To use me here, open FinTrack, go to Finn, choose WhatsApp and link this number. You will get a 6-digit code to send me.";

/**
 * One incoming WhatsApp message, end to end. The sender is trusted only if their number was linked and verified in the
 * app (they proved it by sending a code from that phone). Questions go through the same path as in the app, with the
 * same plan allowance and figure checks. A change ("add 450 for groceries") is only proposed: nothing is saved until the
 * person replies YES, and the save re-checks everything exactly as the in-app Confirm button does.
 */
export async function handleIncoming(msg: Incoming): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  const reply = (t: string) => sendWhatsApp(msg.from, t);

  // A delivery that arrives twice is acted on once.
  const { error: dup } = await admin
    .from("whatsapp_seen")
    .insert({ msg_id: msg.id });
  if (dup) return;

  const phone = `+${msg.from}`;

  const code = parseLinkCode(msg.text);
  if (code) {
    const { data } = await admin
      .from("whatsapp_links")
      .update({ verified_at: new Date().toISOString(), code: null })
      .eq("phone", phone)
      .eq("code", code)
      .is("verified_at", null)
      .gt("code_expires_at", new Date().toISOString())
      .select("user_id");
    await reply(
      data?.length
        ? "Linked. You can now ask me about your money here, or say things like “add 450 for groceries”. You can unlink this number in the app any time."
        : "That code did not work or has expired. Make a new one in FinTrack (Finn, then WhatsApp) and send it from this same number.",
    );
    return;
  }

  const { data: link } = await admin
    .from("whatsapp_links")
    .select("user_id,pending")
    .eq("phone", phone)
    .not("verified_at", "is", null)
    .maybeSingle();
  if (!link) {
    await reply(HELP);
    return;
  }
  const userId = link.user_id as string;
  const clearPending = () =>
    admin
      .from("whatsapp_links")
      .update({ pending: null })
      .eq("user_id", userId);

  const ctx = await contextFor(userId);
  if (!ctx) {
    await reply(
      "I could not open your FinTrack account just now. Please try again in a minute.",
    );
    return;
  }

  // A reply to something Finn proposed.
  const pending = link.pending as { action: FinnAction } | null;
  const confirm = parseConfirm(msg.text);
  if (pending && confirm) {
    await clearPending();
    if (confirm === "no") {
      await reply("Okay, I did not save anything.");
      return;
    }
    const r = await executeFinnAction(ctx, pending.action);
    await reply(r.ok ? `Done. ${r.message}` : r.message);
    return;
  }
  if (pending) await clearPending();

  try {
    const proposal = await proposeAction(msg.text, ctx);
    if (proposal) {
      const card = proposal.visuals.find((v) => v.type === "action");
      if (card && card.type === "action") {
        await admin
          .from("whatsapp_links")
          .update({ pending: { action: card.action } })
          .eq("user_id", userId);
        await reply(
          `${describeAction(card.action)}\n\nReply YES to save it, or NO to cancel.`,
        );
      } else await reply(proposal.text);
      return;
    }
  } catch {
    /* a proposal that cannot be built falls through to a normal question */
  }

  const { limits } = await planLimitsFor(ctx);
  const out = await ask(msg.text, {
    usage: usageStoreFor(ctx.supabase),
    plan: limits,
    loadFacts: () => loadFacts(ctx),
    region: { country: ctx.profile.country ?? null, currency: ctx.space.currency },
    answerCache: databaseAnswerCache(),
  });
  await reply(
    out.ok ? forWhatsApp(out.answer) : (out.message ?? MESSAGES.unavailable),
  );
}
