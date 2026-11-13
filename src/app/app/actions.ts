"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COMMON_TIMEZONES, starterCategories, type Persona } from "@/config/categories";
import { adjustmentPosting, expensePosting, incomePosting, transferPosting } from "@/domain/ledger";
import { MoneyError, isSupportedCurrency, parseAmount } from "@/domain/money";
import { localDate, startOfLocalDay } from "@/domain/period";
import { getContext, requireSpace } from "@/server/context";
import { friendlyDbError, persistPosting } from "@/server/ledger-write";
import { isLiability, type AccountType } from "@/server/types";

export interface ActionState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Submitted values echoed back on failure: React resets uncontrolled fields after an action. */
  values?: Record<string, string>;
}

function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

function withEcho(res: ActionState, form: FormData): ActionState {
  return res.error || res.fieldErrors ? { ...res, values: echo(form) } : res;
}

const ACCOUNT_TYPES = ["savings", "current", "cash", "credit_card", "wallet", "investment", "other_asset", "other_liability"] as const;

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "form");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ───────────────────────── onboarding ───────────────────────── */

export async function saveProfileStep(prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  return withEcho(await saveProfileStepImpl(prev, form), form);
}

async function saveProfileStepImpl(_: ActionState | undefined, form: FormData): Promise<ActionState> {
  const { supabase, user, profile, space } = await getContext();
  const parsed = z
    .object({
      persona: z.enum(["student", "professional", "household", "other"], { message: "Choose the option that fits you best." }),
      currency: z.string().refine(isSupportedCurrency, "Choose a currency from the list."),
      timezone: z.string().refine((tz) => COMMON_TIMEZONES.includes(tz) && validTimezone(tz), "Choose a timezone from the list."),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { persona, currency, timezone } = parsed.data;

  let spaceId = space?.id;
  if (!spaceId) {
    const name = (profile.display_name || user.email?.split("@")[0] || "My") + "'s finances";
    const { data, error } = await supabase.rpc("create_space", {
      p_name: name.slice(0, 80),
      p_kind: persona === "household" ? "household" : "personal",
      p_currency: currency,
    });
    if (error) return { error: friendlyDbError(error.message) };
    spaceId = (Array.isArray(data) ? data[0] : data).id as string;
    const { error: catErr } = await supabase
      .from("categories")
      .insert(starterCategories(persona as Persona).map((c) => ({ ...c, space_id: spaceId })));
    if (catErr) return { error: friendlyDbError(catErr.message) };
  }
  const { error } = await supabase.from("profiles").update({ persona, currency, timezone, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  if (error) return { error: friendlyDbError(error.message) };
  redirect("/app/onboarding");
}

export async function skipAccountStep() {
  const { supabase, user, profile } = await getContext();
  await supabase
    .from("profiles")
    .update({ onboarding_state: { ...profile.onboarding_state, accountSkipped: true } })
    .eq("user_id", user.id);
  redirect("/app/onboarding");
}

export async function completeOnboarding() {
  const { supabase, user } = await getContext();
  await supabase.from("profiles").update({ onboarding_completed_at: new Date().toISOString() }).eq("user_id", user.id);
  redirect("/app");
}

/* ───────────────────────── accounts ───────────────────────── */

const accountSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name.").max(80, "Use 80 characters or fewer."),
  type: z.enum(ACCOUNT_TYPES, { message: "Choose an account type." }),
  opening: z.string().trim().default("0"),
});

async function createAccount(form: FormData): Promise<ActionState> {
  const { supabase, space } = await getContext();
  if (!space) return { error: "Finish setting up your profile first." };
  const parsed = accountSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { name, type, opening } = parsed.data;

  let openingMinor = 0;
  try {
    openingMinor = opening === "" ? 0 : parseAmount(opening, space.currency);
  } catch (e) {
    return { fieldErrors: { opening: e instanceof MoneyError ? e.message : "Enter an amount like 1500.50." } };
  }
  const liability = isLiability(type as AccountType);
  if (liability && openingMinor < 0) return { fieldErrors: { opening: "Enter the amount you owe as a positive number." } };

  const { data: acct, error } = await supabase
    .from("accounts")
    .insert({ space_id: space.id, name, type, currency: space.currency })
    .select("id")
    .single();
  if (error || !acct) return { error: friendlyDbError(error?.message ?? "") };

  if (openingMinor !== 0) {
    const { data: eq } = await supabase
      .from("categories")
      .select("id")
      .eq("space_id", space.id)
      .eq("kind", "equity")
      .eq("name", "Opening balance")
      .single();
    if (!eq) return { error: "The account was created but its opening balance could not be recorded. Add it as an adjustment." };
    // A card or loan you owe is a credit balance, so the account leg is negative.
    const signed = liability ? -openingMinor : openingMinor;
    const posting = adjustmentPosting({ id: "opening", occurredAt: new Date(), amount: signed, accountId: acct.id, equityId: eq.id });
    const res = await persistPosting(supabase, {
      spaceId: space.id,
      posting,
      currency: space.currency,
      accountIds: new Set([acct.id]),
      description: "Opening balance",
    });
    if (res.error) return { error: res.error };
  }
  return {};
}

export async function createAccountAction(_: ActionState | undefined, form: FormData): Promise<ActionState> {
  const res = await createAccount(form);
  if (res.error || res.fieldErrors) return withEcho(res, form);
  revalidatePath("/app", "layout");
  redirect("/app/accounts");
}

export async function createFirstAccountAction(_: ActionState | undefined, form: FormData): Promise<ActionState> {
  const res = await createAccount(form);
  if (res.error || res.fieldErrors) return withEcho(res, form);
  redirect("/app/onboarding");
}

/* ───────────────────────── transactions ───────────────────────── */

const transactionSchema = z.object({
  type: z.enum(["expense", "income", "transfer"], { message: "Choose a transaction type." }),
  amount: z.string().trim().min(1, "Enter an amount."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  accountId: z.string().uuid("Choose an account."),
  toAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  merchant: z.string().trim().max(120).optional(),
  description: z.string().trim().max(300).optional(),
});

export async function createTransactionAction(prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  return withEcho(await createTransactionActionImpl(prev, form), form);
}

async function createTransactionActionImpl(_: ActionState | undefined, form: FormData): Promise<ActionState> {
  const { supabase, space, profile } = await requireSpace();
  const parsed = transactionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  let amount: number;
  try {
    amount = parseAmount(v.amount, space.currency);
  } catch (e) {
    return { fieldErrors: { amount: e instanceof MoneyError ? e.message : "Enter an amount like 250.00." } };
  }
  if (amount <= 0) return { fieldErrors: { amount: "Enter an amount greater than zero." } };

  const [y, m, d] = v.date.split("-").map(Number);
  // Midday in the user's timezone: the transaction stays on the chosen calendar
  // day for them, whatever UTC date that is.
  const occurredAt = new Date(startOfLocalDay(y, m, d, profile.timezone).getTime() + 12 * 3600 * 1000);
  const today = localDate(new Date(), profile.timezone);
  if (startOfLocalDay(y, m, d, profile.timezone) > startOfLocalDay(today.year, today.month, today.day, profile.timezone)) {
    return { fieldErrors: { date: "Pick today or an earlier date. Future payments belong in Bills." } };
  }

  const base = { id: "new", occurredAt, amount };
  let posting;
  const accountIds = new Set([v.accountId]);
  try {
    if (v.type === "transfer") {
      if (!v.toAccountId) return { fieldErrors: { toAccountId: "Choose the account the money goes to." } };
      accountIds.add(v.toAccountId);
      posting = transferPosting({ ...base, fromAccountId: v.accountId, toAccountId: v.toAccountId });
    } else {
      if (!v.categoryId) return { fieldErrors: { categoryId: "Choose a category." } };
      posting =
        v.type === "expense"
          ? expensePosting({ ...base, accountId: v.accountId, categoryId: v.categoryId })
          : incomePosting({ ...base, accountId: v.accountId, sourceId: v.categoryId });
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "That transaction is not valid." };
  }

  const res = await persistPosting(supabase, {
    spaceId: space.id,
    posting,
    currency: space.currency,
    accountIds,
    merchant: v.merchant || null,
    description: v.description || null,
  });
  if (res.error) return { error: res.error };
  revalidatePath("/app", "layout");
  redirect("/app/transactions?added=1");
}

export async function reverseTransactionAction(form: FormData) {
  const { supabase } = await requireSpace();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) redirect("/app/transactions?error=invalid");
  const { error } = await supabase.rpc("reverse_transaction", { p_txn: id.data });
  revalidatePath("/app", "layout");
  redirect(error ? `/app/transactions?error=${encodeURIComponent(friendlyDbError(error.message))}` : "/app/transactions?reversed=1");
}

/* ───────────────────────── budgets ───────────────────────── */

export async function createBudgetAction(prev: ActionState | undefined, form: FormData): Promise<ActionState> {
  return withEcho(await createBudgetActionImpl(prev, form), form);
}

async function createBudgetActionImpl(_: ActionState | undefined, form: FormData): Promise<ActionState> {
  const { supabase, space, user, profile } = await requireSpace();
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Name the budget.").max(80),
      warnAt: z.coerce.number().int().min(1, "Use 1 to 100.").max(100, "Use 1 to 100."),
    })
    .safeParse({ name: form.get("name"), warnAt: form.get("warnAt") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const allocations: { category_id: string; amount: number }[] = [];
  const errors: Record<string, string> = {};
  for (const [key, raw] of form.entries()) {
    if (!key.startsWith("alloc_") || typeof raw !== "string" || raw.trim() === "") continue;
    try {
      const minor = parseAmount(raw, space.currency);
      if (minor < 0) throw new MoneyError("Use zero or more.");
      if (minor > 0) allocations.push({ category_id: key.slice(6), amount: minor });
    } catch (e) {
      errors[key] = e instanceof MoneyError ? e.message : "Enter an amount like 5000.";
    }
  }
  if (Object.keys(errors).length) return { fieldErrors: errors };
  if (allocations.length === 0) return { error: "Set a limit for at least one category." };

  const now = localDate(new Date(), profile.timezone);
  const startsOn = `${now.year}-${String(now.month).padStart(2, "0")}-01`;
  const { data: budget, error } = await supabase
    .from("budgets")
    .insert({
      space_id: space.id,
      name: parsed.data.name,
      period: "monthly",
      starts_on: startsOn,
      currency: space.currency,
      rollover: form.get("rollover") === "on",
      warn_at: parsed.data.warnAt / 100,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !budget) return { error: friendlyDbError(error?.message ?? "") };

  const { error: allocErr } = await supabase
    .from("budget_allocations")
    .insert(allocations.map((a) => ({ ...a, budget_id: budget.id, space_id: space.id })));
  if (allocErr) {
    await supabase.from("budgets").delete().eq("id", budget.id); // do not leave an empty budget behind
    return { error: friendlyDbError(allocErr.message) };
  }
  revalidatePath("/app", "layout");
  redirect("/app/budgets");
}
