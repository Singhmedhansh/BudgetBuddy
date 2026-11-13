"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { atLeast, requireSpace } from "@/server/context";
import { parseBudgetForm } from "@/server/budget-form";
import { fieldErrors } from "@/server/form-errors";
import { friendlyDbError } from "@/server/ledger-write";

export interface ManageState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}
const echo = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
const fail = (res: ManageState, form: FormData): ManageState => ({ ...res, values: echo(form) });
const VIEW_ONLY = "You have view-only access to this space.";

/* ───────── accounts ───────── */

export async function renameAccountAction(_: ManageState | undefined, form: FormData): Promise<ManageState> {
  const ctx = await requireSpace();
  if (!atLeast(ctx.role, "editor")) return fail({ error: VIEW_ONLY }, form);
  const parsed = z.object({ id: z.string().uuid(), name: z.string({ message: "Give the account a name." }).trim().min(1, "Give the account a name.").max(80, "Use 80 characters or fewer.") }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail({ fieldErrors: fieldErrors(parsed.error) }, form);
  const { id, name } = parsed.data;
  const { data: dupes } = await ctx.supabase.from("accounts").select("id").eq("space_id", ctx.space.id).is("archived_at", null).ilike("name", name.replace(/[%_\\]/g, (c) => `\\${c}`)).neq("id", id);
  if ((dupes ?? []).length > 0) return fail({ fieldErrors: { name: "You already have an account with that name." } }, form);
  const { data, error } = await ctx.supabase.from("accounts").update({ name }).eq("id", id).eq("space_id", ctx.space.id).select("id");
  if (error) return fail({ error: friendlyDbError(error.message) }, form);
  if (!data?.length) return fail({ error: "That account could not be found." }, form);
  revalidatePath("/app", "layout");
  redirect("/app/accounts?renamed=1");
}

/** Archiving hides an account from new transactions and totals. It needs a zero balance, so no money silently disappears from net worth. */
export async function setAccountArchivedAction(form: FormData) {
  const ctx = await requireSpace();
  const parsed = z.object({ id: z.string().uuid(), archive: z.enum(["yes", "no"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/app/accounts?error=invalid");
  if (!atLeast(ctx.role, "editor")) redirect(`/app/accounts?error=${encodeURIComponent(VIEW_ONLY)}`);
  const { id, archive } = parsed.data;
  if (archive === "yes") {
    const { data: b } = await ctx.supabase.from("account_balances").select("ledger_balance").eq("account_id", id).maybeSingle();
    if (b && Number(b.ledger_balance) !== 0) redirect(`/app/accounts?error=${encodeURIComponent("An account can only be archived when its balance is zero. Transfer or adjust the balance first.")}`);
  }
  const { error } = await ctx.supabase.from("accounts").update({ archived_at: archive === "yes" ? new Date().toISOString() : null }).eq("id", id).eq("space_id", ctx.space.id);
  revalidatePath("/app", "layout");
  redirect(error ? `/app/accounts?error=${encodeURIComponent(friendlyDbError(error.message))}` : `/app/accounts?${archive === "yes" ? "archived" : "restored"}=1`);
}

/* ───────── budgets ───────── */

export async function updateBudgetAction(_: ManageState | undefined, form: FormData): Promise<ManageState> {
  const ctx = await requireSpace();
  if (!atLeast(ctx.role, "editor")) return fail({ error: VIEW_ONLY }, form);
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return fail({ error: "That budget could not be found." }, form);
  const input = parseBudgetForm(form, ctx.space.currency);
  if (!input.ok) return fail({ error: input.error, fieldErrors: input.fieldErrors }, form);
  const { name, warnAt, rollover, allocations } = input.value;

  const { data: before } = await ctx.supabase.from("budgets").select("name,warn_at,rollover").eq("id", id.data).maybeSingle();
  const { data: existing } = await ctx.supabase.from("budget_allocations").select("category_id,amount").eq("budget_id", id.data);
  const { data: upd, error } = await ctx.supabase.from("budgets").update({ name, warn_at: warnAt / 100, rollover }).eq("id", id.data).eq("space_id", ctx.space.id).is("archived_at", null).select("id");
  if (error) return fail({ error: friendlyDbError(error.message) }, form);
  if (!upd?.length) return fail({ error: "That budget could not be found." }, form);

  const { error: upErr } = await ctx.supabase.from("budget_allocations").upsert(allocations.map((a) => ({ ...a, budget_id: id.data, space_id: ctx.space.id })), { onConflict: "budget_id,category_id" });
  if (upErr) {
    if (before) await ctx.supabase.from("budgets").update(before).eq("id", id.data); // do not leave a half-applied edit
    return fail({ error: friendlyDbError(upErr.message) }, form);
  }
  const keep = new Set(allocations.map((a) => a.category_id));
  const drop = (existing ?? []).map((e) => e.category_id as string).filter((c) => !keep.has(c));
  if (drop.length) {
    const { error: delErr } = await ctx.supabase.from("budget_allocations").delete().eq("budget_id", id.data).in("category_id", drop);
    if (delErr) return fail({ error: friendlyDbError(delErr.message) }, form);
  }
  revalidatePath("/app", "layout");
  redirect("/app/budgets?updated=1");
}

export async function archiveBudgetAction(form: FormData) {
  const ctx = await requireSpace();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) redirect("/app/budgets?error=invalid");
  if (!atLeast(ctx.role, "editor")) redirect(`/app/budgets?error=${encodeURIComponent(VIEW_ONLY)}`);
  const { error } = await ctx.supabase.from("budgets").update({ archived_at: new Date().toISOString() }).eq("id", id.data).eq("space_id", ctx.space.id);
  revalidatePath("/app", "layout");
  redirect(error ? `/app/budgets?error=${encodeURIComponent(friendlyDbError(error.message))}` : "/app/budgets?archived=1");
}
