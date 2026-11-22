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
