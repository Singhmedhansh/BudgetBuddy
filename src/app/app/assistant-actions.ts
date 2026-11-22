"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { expensePosting, incomePosting } from "@/domain/ledger";
import { parseAmount } from "@/domain/money";
import { localDate, occurredAtForDate, startOfLocalDay } from "@/domain/period";
import { friendlyDbError, persistPosting } from "@/server/ledger-write";
import { proposeAction } from "@/server/ai/finn-actions";
import { AI_ALLOWANCE, type PlanId } from "@/config/plans";
import { atLeast, requireSpace } from "@/server/context";
import { ask, MESSAGES, type UsageStore } from "@/server/ai/assistant";
import { periodStarts, saveExchange, titleFrom } from "@/server/ai/chats";
import { loadFacts } from "@/server/ai/facts";
import { usageStoreFor } from "@/server/ai/usage-store";
import { coalesce, flightKey } from "@/server/ai/inflight";
import type { Visual } from "@/server/ai/visuals";
import {
  resolveEntitlement,
  type EntitlementRow,
} from "@/server/payments/entitlements";

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

  // The plan decides how many questions a day and how many tokens a month. Anything unreadable is the Free plan.
  const { data: ent } = await ctx.supabase
    .from("entitlements")
    .select("plan,status,current_period_end")
    .maybeSingle();
  const plan: PlanId = resolveEntitlement(
    ent as EntitlementRow | null,
    new Date(),
  ).plan;
  const { dayStart, monthStart } = periodStarts(
    new Date(),
    ctx.profile.timezone,
  );
  const allowance = AI_ALLOWANCE[plan];
  const planLimits = {
    questionsPerDay: allowance.questionsPerDay,
    tokensPerMonth: allowance.tokensPerMonth,
    dayStart: dayStart.toISOString(),
    monthStart: monthStart.toISOString(),
  };

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

const actionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("add_transaction"),
    type: z.enum(["expense", "income"]),
    amount: z.number().positive().max(1e9),
    accountId: z.string().uuid(),
    categoryId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    merchant: z.string().max(80).nullable(),
    clientKey: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("set_budget_limit"),
    budgetId: z.string().uuid(),
    categoryId: z.string().uuid(),
    amount: z.number().positive().max(1e9),
  }),
]);

export interface ConfirmResult {
  ok: boolean;
  message: string;
}

/** Carries out a proposal the person confirmed. Everything is checked again here: the browser's copy is never trusted. */
export async function confirmFinnAction(raw: unknown): Promise<ConfirmResult> {
  const ctx = await requireSpace();
  if (!atLeast(ctx.role, "editor"))
    return { ok: false, message: "You have view-only access to this space." };
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      message: "That request is not valid any more. Ask again.",
    };
  const a = parsed.data;
  const { supabase, space, profile } = ctx;

  if (a.kind === "add_transaction") {
    const [{ data: acct }, { data: cat }] = await Promise.all([
      supabase
        .from("accounts")
        .select("id")
        .eq("id", a.accountId)
        .eq("space_id", space.id)
        .is("archived_at", null)
        .maybeSingle(),
      supabase
        .from("categories")
        .select("id,kind")
        .eq("id", a.categoryId)
        .eq("space_id", space.id)
        .is("archived_at", null)
        .maybeSingle(),
    ]);
    if (
      !acct ||
      !cat ||
      cat.kind !== (a.type === "expense" ? "expense" : "income")
    )
      return {
        ok: false,
        message: "That account or category could not be found.",
      };
    const [y, m, d] = a.date.split("-").map(Number);
    const today = localDate(new Date(), profile.timezone);
    if (
      startOfLocalDay(y, m, d, profile.timezone) >
      startOfLocalDay(today.year, today.month, today.day, profile.timezone)
    )
      return { ok: false, message: "That date is in the future." };
    let amount: number;
    try {
      amount = parseAmount(String(a.amount), space.currency);
    } catch {
      return { ok: false, message: "That amount is not valid." };
    }
    const base = {
      id: "new",
      occurredAt: occurredAtForDate(y, m, d, profile.timezone),
      amount,
    };
    const posting =
      a.type === "expense"
        ? expensePosting({
            ...base,
            accountId: a.accountId,
            categoryId: a.categoryId,
          })
        : incomePosting({
            ...base,
            accountId: a.accountId,
            sourceId: a.categoryId,
          });
    const res = await persistPosting(supabase, {
      spaceId: space.id,
      posting,
      currency: space.currency,
      accountIds: new Set([a.accountId]),
      merchant: a.merchant,
      description: "Added by Finn",
      clientKey: a.clientKey,
    });
    if (res.error) return { ok: false, message: res.error };
    revalidatePath("/app", "layout");
    return {
      ok: true,
      message: res.duplicate
        ? "That was already saved."
        : "Saved. It is now in your transactions.",
    };
  }

  const [{ data: budget }, { data: cat }] = await Promise.all([
    supabase
      .from("budgets")
      .select("id")
      .eq("id", a.budgetId)
      .eq("space_id", space.id)
      .is("archived_at", null)
      .maybeSingle(),
    supabase
      .from("categories")
      .select("id")
      .eq("id", a.categoryId)
      .eq("space_id", space.id)
      .eq("kind", "expense")
      .is("archived_at", null)
      .maybeSingle(),
  ]);
  if (!budget || !cat)
    return {
      ok: false,
      message: "That budget or category could not be found.",
    };
  let minor: number;
  try {
    minor = parseAmount(String(a.amount), space.currency);
  } catch {
    return { ok: false, message: "That amount is not valid." };
  }
  const { error } = await supabase
    .from("budget_allocations")
    .upsert(
      {
        budget_id: a.budgetId,
        category_id: a.categoryId,
        space_id: space.id,
        amount: minor,
      },
      { onConflict: "budget_id,category_id" },
    );
  if (error) return { ok: false, message: friendlyDbError(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Budget updated." };
}
