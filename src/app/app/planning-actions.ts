"use server";

import { fieldErrors } from "@/server/form-errors";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MoneyError, formatMoney, parseAmount } from "@/domain/money";
import { occurredAtForDate } from "@/domain/period";
import { parseDate } from "@/domain/recurrence";
import { requireSpace } from "@/server/context";
import { friendlyDbError } from "@/server/ledger-write";
import { todayFor } from "@/server/planning";

export interface PlanState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
const withEcho = (res: PlanState, form: FormData): PlanState => (res.error || res.fieldErrors ? { ...res, values: echo(form) } : res);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.").refine((s) => {
  try {
    parseDate(s);
    return true;
  } catch {
    return false;
  }
}, "Choose a real date.");

function money(raw: string, currency: string, field: string, allowZero = false): { value?: number; errors?: Record<string, string> } {
  try {
    const v = parseAmount(raw, currency);
    if (v < 0 || (!allowZero && v === 0)) return { errors: { [field]: allowZero ? "Use zero or more." : "Enter an amount greater than zero." } };
    return { value: v };
  } catch (e) {
    return { errors: { [field]: e instanceof MoneyError && !e.message.startsWith("Invalid amount") ? e.message : "Enter an amount like 2500.00." } };
  }
}

/* ───────────── goals ───────────── */

async function createGoalImpl(form: FormData): Promise<PlanState> {
  const { supabase, space, user, profile } = await requireSpace();
  const p = z
    .object({
      name: z.string().trim().min(1, "Name the goal.").max(80),
      target: z.string().trim().min(1, "Enter a target amount."),
      deadline: z.union([dateStr, z.literal("")]).optional(),
      priority: z.enum(["1", "2", "3"]).default("2"),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { fieldErrors: fieldErrors(p.error) };
  const target = money(p.data.target, space.currency, "target");
  if (!target.value) return { fieldErrors: target.errors };
  if (p.data.deadline && p.data.deadline <= todayFor({ profile })) return { fieldErrors: { deadline: "Choose a deadline after today, or leave it blank." } };
  const { error } = await supabase.from("savings_goals").insert({
    space_id: space.id,
    name: p.data.name,
    target_amount: target.value,
    currency: space.currency,
    deadline: p.data.deadline || null,
    priority: Number(p.data.priority),
    created_by: user.id,
  });
  if (error) return { error: friendlyDbError(error.message) };
  return {};
}
export async function createGoalAction(_: PlanState | undefined, form: FormData): Promise<PlanState> {
  const r = await createGoalImpl(form);
  if (r.error || r.fieldErrors) return withEcho(r, form);
  revalidatePath("/app", "layout");
  redirect("/app/goals?added=1");
}

async function updateGoalImpl(form: FormData): Promise<PlanState> {
  const { supabase, space, profile } = await requireSpace();
  const p = z
    .object({
      id: z.string().uuid(),
      name: z.string().trim().min(1, "Name the goal.").max(80),
      target: z.string().trim().min(1, "Enter a target amount."),
      deadline: z.union([dateStr, z.literal("")]).optional(),
      priority: z.enum(["1", "2", "3"]).default("2"),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { fieldErrors: fieldErrors(p.error) };
  const target = money(p.data.target, space.currency, "target");
  if (!target.value) return { fieldErrors: target.errors };
  const { data: current } = await supabase.from("savings_goals").select("deadline").eq("id", p.data.id).eq("space_id", space.id).maybeSingle();
  if (!current) return { error: "That goal was not found." };
  // A deadline that has already passed can be kept as it is, but a new one has to be in the future.
  const unchanged = (current.deadline ?? "") === (p.data.deadline ?? "");
  if (p.data.deadline && !unchanged && p.data.deadline <= todayFor({ profile })) return { fieldErrors: { deadline: "Choose a deadline after today, or leave it blank." } };
  const { data: updated, error } = await supabase
    .from("savings_goals")
    .update({ name: p.data.name, target_amount: target.value, deadline: p.data.deadline || null, priority: Number(p.data.priority) })
    .eq("id", p.data.id)
    .eq("space_id", space.id)
    .select("id");
  if (error) return { error: friendlyDbError(error.message) };
  if (!updated || updated.length === 0) return { error: "You do not have permission to change this goal." };
  return {};
}
export async function updateGoalAction(_: PlanState | undefined, form: FormData): Promise<PlanState> {
  const r = await updateGoalImpl(form);
  if (r.error || r.fieldErrors) return withEcho(r, form);
  revalidatePath("/app", "layout");
  redirect("/app/goals?saved=1");
}

export async function addContributionAction(form: FormData) {
  const { supabase, space, user, profile } = await requireSpace();
  const p = z
    .object({ goalId: z.string().uuid(), amount: z.string().trim().min(1), direction: z.enum(["add", "withdraw"]), note: z.string().trim().max(200).optional() })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/app/goals?error=" + encodeURIComponent("Enter an amount to add."));
  const amt = money(p.data.amount, space.currency, "amount");
  if (!amt.value) redirect("/app/goals?error=" + encodeURIComponent(Object.values(amt.errors!)[0]));
  if (p.data.direction === "withdraw") {
    // Only what has been saved can be taken out. The database enforces the same rule, so two quick requests cannot get past it.
    const { data: rows } = await supabase.from("goal_contributions").select("amount").eq("goal_id", p.data.goalId).eq("space_id", space.id);
    const savedSoFar = (rows ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
    if (amt.value > savedSoFar) {
      redirect("/app/goals?error=" + encodeURIComponent(`You can take out at most ${formatMoney(Math.max(0, savedSoFar), space.currency)}, which is what is saved for this goal.`));
    }
  }
  const signed = p.data.direction === "withdraw" ? -amt.value : amt.value;
  const { error } = await supabase.from("goal_contributions").insert({
    goal_id: p.data.goalId,
    space_id: space.id,
    amount: signed,
    contributed_on: todayFor({ profile }),
    note: p.data.note || null,
    created_by: user.id,
  });
  revalidatePath("/app", "layout");
  redirect(error ? "/app/goals?error=" + encodeURIComponent(friendlyDbError(error.message)) : "/app/goals?saved=1");
}

export async function setGoalStatusAction(form: FormData) {
  const { supabase } = await requireSpace();
  const p = z.object({ goalId: z.string().uuid(), status: z.enum(["active", "paused", "completed", "archived"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/app/goals");
  await supabase.from("savings_goals").update({ status: p.data.status }).eq("id", p.data.goalId);
  revalidatePath("/app", "layout");
  redirect("/app/goals");
}

/* ───────────── bills, subscriptions, income ───────────── */

const KIND_PATH = { bill: "/app/bills", subscription: "/app/subscriptions", income: "/app/income" } as const;
const FREQ = ["once", "weekly", "monthly", "quarterly", "yearly"] as const;

async function createRecurringImpl(form: FormData): Promise<PlanState> {
  const { supabase, space, user } = await requireSpace();
  const p = z
    .object({
      kind: z.enum(["bill", "subscription", "income"]),
      name: z.string().trim().min(1, "Give it a name.").max(80),
      amount: z.string().trim().min(1, "Enter an amount."),
      frequency: z.enum(FREQ, { message: "Choose how often." }),
      firstDue: dateStr,
      endsOn: z.union([dateStr, z.literal("")]).optional(),
      accountId: z.string().uuid("Choose an account."),
      categoryId: z.string().uuid("Choose a category."),
      remindDays: z.coerce.number().int().min(0, "Use 0 to 60.").max(60, "Use 0 to 60.").default(3),
      notes: z.string().trim().max(500).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { fieldErrors: fieldErrors(p.error) };
  const amt = money(p.data.amount, space.currency, "amount");
  if (!amt.value) return { fieldErrors: amt.errors };
  if (p.data.endsOn && p.data.endsOn < p.data.firstDue) return { fieldErrors: { endsOn: "The end date must be on or after the first date." } };
  const { error } = await supabase.from("recurring_items").insert({
    space_id: space.id,
    kind: p.data.kind,
    name: p.data.name,
    amount: amt.value,
    currency: space.currency,
    frequency: p.data.frequency,
    first_due: p.data.firstDue,
    ends_on: p.data.endsOn || null,
    account_id: p.data.accountId,
    category_id: p.data.categoryId,
    remind_days: p.data.remindDays,
    auto_renews: form.get("autoRenews") === "on",
    notes: p.data.notes || null,
    created_by: user.id,
  });
  if (error) return { error: friendlyDbError(error.message) };
  return {};
}
export async function createRecurringAction(_: PlanState | undefined, form: FormData): Promise<PlanState> {
  const r = await createRecurringImpl(form);
  if (r.error || r.fieldErrors) return withEcho(r, form);
  const kind = z.enum(["bill", "subscription", "income"]).parse(form.get("kind"));
  revalidatePath("/app", "layout");
  redirect(`${KIND_PATH[kind]}?added=1`);
}

/** Mark one due date paid (bill/subscription) or received (income): posts the real transaction. */
export async function settleItemAction(form: FormData) {
  const { supabase, profile } = await requireSpace();
  const p = z.object({ id: z.string().uuid(), due: dateStr, kind: z.enum(["bill", "subscription", "income"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/app/bills");
  const [y, m, d] = todayFor({ profile }).split("-").map(Number);
  const paidOn = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const occurredAt = occurredAtForDate(y, m, d, profile.timezone);
  const { error } = await supabase.rpc("settle_recurring_item", { p_item: p.data.id, p_due: p.data.due, p_paid_on: paidOn, p_occurred_at: occurredAt.toISOString() });
  revalidatePath("/app", "layout");
  const base = KIND_PATH[p.data.kind];
  const msg = error
    ? error.message.includes("already_settled")
      ? "That one was already marked done."
      : error.message.includes("account and category")
        ? "Choose an account and category for this item first."
        : friendlyDbError(error.message)
    : null;
  redirect(msg ? `${base}?error=${encodeURIComponent(msg)}` : `${base}?settled=1`);
}

export async function setItemStatusAction(form: FormData) {
  const { supabase } = await requireSpace();
  const p = z.object({ id: z.string().uuid(), status: z.enum(["active", "paused", "cancelled"]), kind: z.enum(["bill", "subscription", "income"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/app/bills");
  await supabase.from("recurring_items").update({ status: p.data.status }).eq("id", p.data.id);
  revalidatePath("/app", "layout");
  redirect(KIND_PATH[p.data.kind]);
}

/* ───────────── debt terms ───────────── */

export async function saveDebtTermsAction(form: FormData) {
  const { supabase, space } = await requireSpace();
  const p = z
    .object({ accountId: z.string().uuid(), rate: z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a rate like 12.5."), minPayment: z.string().trim().min(1), dueDay: z.string().trim().optional() })
    .safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/app/debt?error=" + encodeURIComponent("Enter the interest rate as a percentage, like 12.5."));
  const min = money(p.data.minPayment, space.currency, "minPayment", true);
  if (min.value === undefined) redirect("/app/debt?error=" + encodeURIComponent(Object.values(min.errors!)[0]));
  const day = p.data.dueDay ? Number(p.data.dueDay) : null;
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) redirect("/app/debt?error=" + encodeURIComponent("Due day must be 1 to 31."));
  const bps = Math.round(Number(p.data.rate) * 100);
  const { error } = await supabase.from("debt_terms").upsert(
    { account_id: p.data.accountId, space_id: space.id, interest_rate_bps: bps, min_payment: min.value, due_day: day, updated_at: new Date().toISOString() },
    { onConflict: "account_id" },
  );
  revalidatePath("/app", "layout");
  redirect(error ? "/app/debt?error=" + encodeURIComponent(friendlyDbError(error.message)) : "/app/debt?saved=1");
}
