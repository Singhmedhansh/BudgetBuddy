"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { refundPosting } from "@/domain/ledger";
import { MoneyError, parseAmount } from "@/domain/money";
import { localDate, occurredAtForDate, startOfLocalDay } from "@/domain/period";
import { atLeast, requireSpace } from "@/server/context";
import { fieldErrors } from "@/server/form-errors";
import { friendlyDbError, persistPosting } from "@/server/ledger-write";
import { loadRefundContext } from "@/server/refunds";

export interface TxnActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}
const echo = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
const fail = (res: TxnActionState, form: FormData): TxnActionState => ({ ...res, values: echo(form) });

export async function refundTransactionAction(_: TxnActionState | undefined, form: FormData): Promise<TxnActionState> {
  const ctx = await requireSpace();
  if (!atLeast(ctx.role, "editor")) return fail({ error: "You have view-only access to this space." }, form);
  const parsed = z
    .object({
      id: z.string().uuid(),
      amount: z.string().trim().min(1, "Enter an amount."),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
      accountId: z.string({ message: "Choose an account." }).uuid("Choose an account."),
      clientKey: z.string().uuid().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail({ fieldErrors: fieldErrors(parsed.error) }, form);
  const v = parsed.data;
  const rc = await loadRefundContext(ctx, v.id);
  if (!rc) return fail({ error: "This expense cannot be refunded. It may already be reversed." }, form);

  let amount: number;
  try {
    amount = parseAmount(v.amount, ctx.space.currency);
  } catch (e) {
    return fail({ fieldErrors: { amount: e instanceof MoneyError ? e.message : "Enter an amount like 250.00." } }, form);
  }
  if (amount <= 0) return fail({ fieldErrors: { amount: "Enter an amount greater than zero." } }, form);
  if (amount > rc.remaining) return fail({ fieldErrors: { amount: "That is more than what is left to refund on this expense." } }, form);

  const [y, m, d] = v.date.split("-").map(Number);
  const tz = ctx.profile.timezone;
  const today = localDate(new Date(), tz);
  if (startOfLocalDay(y, m, d, tz) > startOfLocalDay(today.year, today.month, today.day, tz)) return fail({ fieldErrors: { date: "Pick today or an earlier date." } }, form);
  const occurredAt = occurredAtForDate(y, m, d, tz);

  let posting;
  try {
    posting = refundPosting({ id: "new", occurredAt, amount, accountId: v.accountId }, rc.original, rc.existing);
  } catch (e) {
    return fail({ error: e instanceof Error ? e.message : "That refund is not valid." }, form);
  }
  const res = await persistPosting(ctx.supabase, {
    spaceId: ctx.space.id,
    posting,
    currency: ctx.space.currency,
    accountIds: new Set([v.accountId]),
    refundOf: rc.originalId,
    description: `Refund: ${rc.label}`,
    clientKey: v.clientKey,
  });
  if (res.error) return fail({ error: res.error }, form);
  revalidatePath("/app", "layout");
  redirect("/app/transactions?refunded=1");
}

const editSchema = z.object({
  id: z.string().uuid(),
  merchant: z.string().trim().max(120, "Use 120 characters or fewer.").optional(),
  description: z.string().trim().max(300, "Use 300 characters or fewer.").optional(),
  notes: z.string().trim().max(1000, "Use 1000 characters or fewer.").optional(),
});

/** Corrects the descriptive details of a transaction. Amounts, dates, accounts and categories are never edited: reverse and re-enter instead. */
export async function updateTransactionDetailsAction(_: TxnActionState | undefined, form: FormData): Promise<TxnActionState> {
  const ctx = await requireSpace();
  if (!atLeast(ctx.role, "editor")) return fail({ error: "You have view-only access to this space." }, form);
  const parsed = editSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail({ fieldErrors: fieldErrors(parsed.error) }, form);
  const { id, merchant, description, notes } = parsed.data;
  const { data, error } = await ctx.supabase
    .from("transactions")
    .update({ merchant: merchant || null, description: description || null, notes: notes || null })
    .eq("id", id)
    .eq("space_id", ctx.space.id)
    .select("id");
  if (error) return fail({ error: friendlyDbError(error.message) }, form);
  if (!data || data.length === 0) return fail({ error: "That transaction could not be found." }, form);
  revalidatePath("/app", "layout");
  redirect("/app/transactions?edited=1");
}
