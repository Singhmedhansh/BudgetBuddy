"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { executeFinnAction } from "@/server/ai/finn-execute";
import { planLimitsFor } from "@/server/ai/session";
import { proposeAction } from "@/server/ai/finn-actions";
import { type PlanId } from "@/config/plans";
import { requireSpace } from "@/server/context";
import { ask, MESSAGES, type UsageStore } from "@/server/ai/assistant";
import { saveExchange, titleFrom } from "@/server/ai/chats";
import { loadFacts } from "@/server/ai/facts";
import { usageStoreFor } from "@/server/ai/usage-store";
import { coalesce, flightKey } from "@/server/ai/inflight";
import type { Visual } from "@/server/ai/visuals";

export interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Marks an answer built only from verified figures rather than free model text, or from general knowledge. */
  source?: "model" | "figures" | "general";
  /** Charts and cards built from the verified figures, shown under the answer. */
  visuals?: Visual[];
  /** The saved message, once stored, so a thumbs mark can be attached to it. */
  id?: number;
  feedback?: "up" | "down";
}
export interface AssistantState {
  turns: Turn[];
  error?: string;
  question?: string;
  /** The saved chat these turns belong to, once the first exchange has been stored. */
  chatId?: string | null;
  /** Set when the plan's allowance ran out, so the page can offer the right next step. */
  limit?: { kind: "day" | "month"; plan: PlanId };
}

const turnSchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(2000),
      source: z.enum(["model", "figures", "general"]).optional(),
      visuals: z.array(z.any()).max(4).optional(),
      id: z.number().int().optional(),
      feedback: z.enum(["up", "down"]).optional(),
    }),
  )
  .max(40);

export async function askAssistantAction(
  prev: AssistantState | undefined,
  form: FormData,
): Promise<AssistantState> {
  const ctx = await requireSpace();
  let parsedHistory: unknown = [];
  try {
    parsedHistory = JSON.parse(String(form.get("history") ?? "[]") || "[]");
  } catch {
    /* a malformed history field is treated as an empty conversation */
  }
  const history = turnSchema.safeParse(parsedHistory);
  const turns: Turn[] = history.success ? history.data : [];
  const question = String(form.get("question") ?? "");
  const chatField = String(form.get("chat") ?? "");
  const chatId = /^[0-9a-f-]{36}$/i.test(chatField) ? chatField : null;

  // A request to change something ("add a 450 grocery expense") becomes a proposal to confirm. No model, no allowance used.
  try {
    const proposal = await proposeAction(question, ctx);
    if (proposal) {
      const reply: Turn = {
        role: "assistant",
        content: proposal.text,
        source: "figures",
        visuals: proposal.visuals,
      };
      const saved = await saveExchange(ctx.supabase, {
        userId: ctx.user.id,
        spaceId: ctx.space.id,
        chatId,
        question: question.trim(),
        answer: reply,
      });
      return {
        turns: [
          ...turns,
          { role: "user" as const, content: question.trim() },
          { ...reply, id: saved?.answerId ?? undefined },
        ].slice(-40),
        chatId: saved?.chatId ?? chatId,
      };
    }
  } catch {
    /* if a proposal cannot be built, the question goes to Finn as usual */
  }

  const usage: UsageStore = usageStoreFor(ctx.supabase);

  const { plan, limits: planLimits } = await planLimitsFor(ctx);

  // Identical concurrent submissions from this person share one reservation and one provider call.
  const history2 = turns.map(({ role, content }) => ({ role, content }));
  const out = await coalesce(
    flightKey(
      ctx.user.id,
      ctx.space.id,
      question.trim(),
      JSON.stringify(history2.slice(-4)),
    ),
    () =>
      ask(
        question,
        { usage, plan: planLimits, loadFacts: () => loadFacts(ctx) },
        history2,
      ),
  );
  if (!out.ok) {
    const limit =
      out.reason === "plan_day"
        ? ({ kind: "day", plan } as const)
        : out.reason === "plan_month"
          ? ({ kind: "month", plan } as const)
          : undefined;
    return {
      turns,
      error: out.message ?? MESSAGES.unavailable,
      question,
      chatId,
      limit,
    };
  }
  const answer: Turn = {
    role: "assistant",
    content: out.answer,
    source: out.source,
    visuals: out.visuals,
  };
  const saved = await saveExchange(ctx.supabase, {
    userId: ctx.user.id,
    spaceId: ctx.space.id,
    chatId,
    question: question.trim(),
    answer,
  });
  const next: Turn[] = [
    ...turns,
    { role: "user", content: question.trim() },
    { ...answer, id: saved?.answerId ?? undefined },
  ];
  return { turns: next.slice(-40), chatId: saved?.chatId ?? chatId };
}

const idSchema = z.string().regex(/^[0-9a-f-]{36}$/i);

export async function renameChatAction(
  id: string,
  title: string,
): Promise<void> {
  const ctx = await requireSpace();
  const parsed = idSchema.safeParse(id);
  const name = titleFrom(title);
  if (!parsed.success || !title.trim()) return;
  await ctx.supabase
    .from("finn_conversations")
    .update({ title: name })
    .eq("id", parsed.data);
  revalidatePath("/app/assistant");
}

export async function pinChatAction(
  id: string,
  pinned: boolean,
): Promise<void> {
  const ctx = await requireSpace();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return;
  await ctx.supabase
    .from("finn_conversations")
    .update({ pinned })
    .eq("id", parsed.data);
  revalidatePath("/app/assistant");
}

export async function deleteChatAction(id: string): Promise<void> {
  const ctx = await requireSpace();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return;
  await ctx.supabase.from("finn_conversations").delete().eq("id", parsed.data);
  revalidatePath("/app/assistant");
}

export async function feedbackAction(
  messageId: number,
  value: "up" | "down" | null,
): Promise<void> {
  const ctx = await requireSpace();
  if (!Number.isInteger(messageId) || messageId <= 0) return;
  await ctx.supabase
    .from("finn_messages")
    .update({ feedback: value })
    .eq("id", messageId);
}

export type { ConfirmResult } from "@/server/ai/finn-execute";

/** Carries out a proposal the person confirmed. Everything is checked again in the executor: the browser's copy is never trusted. */
export async function confirmFinnAction(
  raw: unknown,
): Promise<import("@/server/ai/finn-execute").ConfirmResult> {
  const ctx = await requireSpace();
  return executeFinnAction(ctx, raw);
}
