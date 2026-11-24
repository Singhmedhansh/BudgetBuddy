import { revalidatePath } from "next/cache";
import { z } from "zod";
import { expensePosting, incomePosting } from "@/domain/ledger";
import { parseAmount } from "@/domain/money";
import { localDate, occurredAtForDate, startOfLocalDay } from "@/domain/period";
import { atLeast, type requireSpace } from "@/server/context";
import { friendlyDbError, persistPosting } from "@/server/ledger-write";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

export const actionSchema = z.discriminatedUnion("kind", [
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

export type FinnActionInput = z.infer<typeof actionSchema>;

export interface ConfirmResult {
  ok: boolean;
  message: string;
  /** The transaction Finn created, so it can be undone. */
  transactionId?: string;
}

/**
 * Carries out an action the person confirmed (in the app or by WhatsApp). Everything is checked again here against
 * the person's own space: the copy that came from the browser or the message is never trusted.
 */
export async function executeFinnAction(
  ctx: Ctx,
  raw: unknown,
): Promise<ConfirmResult> {
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
      ...(res.id ? { transactionId: res.id } : {}),
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
  const { error } = await supabase.from("budget_allocations").upsert(
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

/**
 * Undoes a transaction Finn just added, by reversing it the same way the Transactions page does, so the ledger stays
 * balanced and the history shows what happened. Only a transaction Finn created in this space, in the last day, can be
 * undone this way.
 */
export async function undoFinnTransaction(
  ctx: Ctx,
  id: unknown,
): Promise<ConfirmResult> {
  if (!atLeast(ctx.role, "editor"))
    return { ok: false, message: "You have view-only access to this space." };
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success)
    return { ok: false, message: "That entry could not be found." };
  const { data: txn } = await ctx.supabase
    .from("transactions")
    .select("id,description,created_at")
    .eq("id", parsed.data)
    .eq("space_id", ctx.space.id)
    .maybeSingle();
  const t = txn as {
    id: string;
    description: string | null;
    created_at: string;
  } | null;
  if (
    !t ||
    t.description !== "Added by Finn" ||
    Date.now() - new Date(t.created_at).getTime() > 86_400_000
  )
    return {
      ok: false,
      message:
        "That entry can no longer be undone here. Reverse it from Transactions.",
    };
  const { error } = await ctx.supabase.rpc("reverse_transaction", {
    p_txn: t.id,
  });
  if (error) return { ok: false, message: friendlyDbError(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Undone. Nothing was recorded." };
}

/** The person's accounts and categories, for changing a card before it is saved. Names and ids only. */
export async function finnEditOptions(ctx: Ctx, type: "expense" | "income") {
  const [{ data: accounts }, { data: categories }] = await Promise.all([
    ctx.supabase
      .from("accounts")
      .select("id,name")
      .eq("space_id", ctx.space.id)
      .is("archived_at", null)
      .order("name"),
    ctx.supabase
      .from("categories")
      .select("id,name")
      .eq("space_id", ctx.space.id)
      .eq("kind", type)
      .is("archived_at", null)
      .order("name"),
  ]);
  return {
    currency: ctx.space.currency,
    accounts: (accounts ?? []) as { id: string; name: string }[],
    categories: (categories ?? []) as { id: string; name: string }[],
  };
}
