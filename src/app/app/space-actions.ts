"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COMMON_TIMEZONES, starterCategories } from "@/config/categories";
import { isSupportedCurrency } from "@/domain/money";
import { ACTIVE_SPACE_COOKIE, atLeast, getContext, requireSpace } from "@/server/context";
import { fieldErrors } from "@/server/form-errors";
import { friendlyDbError } from "@/server/ledger-write";

export interface SpaceState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}
const echo = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
const fail = (res: SpaceState, form: FormData): SpaceState => ({ ...res, values: echo(form) });
void COMMON_TIMEZONES;

async function setActive(id: string) {
  (await cookies()).set(ACTIVE_SPACE_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
}

/** Creates an additional space (for example a household budget) with starter categories, and makes it the active one. */
export async function createSpaceAction(_: SpaceState | undefined, form: FormData): Promise<SpaceState> {
  const { supabase } = await getContext();
  const parsed = z
    .object({
      name: z.string({ message: "Name the space." }).trim().min(1, "Name the space.").max(80, "Use 80 characters or fewer."),
      kind: z.enum(["household", "couple", "family", "roommates", "personal"], { message: "Choose what this space is for." }),
      currency: z.string({ message: "Choose a currency." }).refine(isSupportedCurrency, "Choose a currency from the list."),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail({ fieldErrors: fieldErrors(parsed.error) }, form);
  const { name, kind, currency } = parsed.data;
  const { data, error } = await supabase.rpc("create_space", { p_name: name, p_kind: kind, p_currency: currency });
  if (error) return fail({ error: friendlyDbError(error.message) }, form);
  const id = (Array.isArray(data) ? data[0] : data).id as string;
  const { error: catErr } = await supabase.from("categories").insert(starterCategories(kind === "personal" ? "other" : "household").map((c) => ({ ...c, space_id: id })));
  if (catErr) return fail({ error: "The space was created but its categories could not be added. Open it and try again." }, form);
  await setActive(id);
  revalidatePath("/app", "layout");
  redirect("/app/members?created=1");
}

export async function switchSpaceAction(form: FormData) {
  const { spaces } = await getContext();
  const id = z.string().uuid().safeParse(form.get("space"));
  if (!id.success || !spaces.some((s) => s.id === id.data)) redirect("/app");
  await setActive(id.data);
  revalidatePath("/app", "layout");
  redirect("/app");
}

/* ───────── invitations and members (database functions from migration 8) ───────── */

const roleSchema = z.enum(["admin", "editor", "viewer"]);

export async function createInviteAction(_: SpaceState | undefined, form: FormData): Promise<SpaceState & { code?: string }> {
  const ctx = await requireSpace();
  if (!atLeast(ctx.role, "admin")) return { error: "Only an admin can invite people." };
  const role = roleSchema.safeParse(form.get("role"));
  if (!role.success) return { fieldErrors: { role: "Choose a role." } };
  const { data, error } = await ctx.supabase.rpc("create_invite", { p_space: ctx.space.id, p_role: role.data });
  if (error) return { error: memberError(error.message) };
  revalidatePath("/app/members");
  return { code: data as string };
}

export async function revokeInviteAction(form: FormData) {
  const ctx = await requireSpace();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) redirect("/app/members?error=invalid");
  const { error } = await ctx.supabase.rpc("revoke_invite", { p_invite: id.data });
  revalidatePath("/app/members");
  redirect(error ? `/app/members?error=${encodeURIComponent(memberError(error.message))}` : "/app/members?revoked=1");
}

export async function setMemberRoleAction(form: FormData) {
  const ctx = await requireSpace();
  const p = z.object({ user: z.string().uuid(), role: roleSchema }).safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/app/members?error=invalid");
  const { error } = await ctx.supabase.rpc("set_member_role", { p_space: ctx.space.id, p_user: p.data.user, p_role: p.data.role });
  revalidatePath("/app", "layout");
  redirect(error ? `/app/members?error=${encodeURIComponent(memberError(error.message))}` : "/app/members?updated=1");
}

export async function removeMemberAction(form: FormData) {
  const ctx = await requireSpace();
  const user = z.string().uuid().safeParse(form.get("user"));
  if (!user.success) redirect("/app/members?error=invalid");
  const { error } = await ctx.supabase.rpc("remove_member", { p_space: ctx.space.id, p_user: user.data });
  if (error) redirect(`/app/members?error=${encodeURIComponent(memberError(error.message))}`);
  revalidatePath("/app", "layout");
  // Leaving removes access to this space, so drop the choice and fall back to the person's first space.
  if (user.data === ctx.user.id) {
    (await cookies()).delete(ACTIVE_SPACE_COOKIE);
    redirect("/app");
  }
  redirect("/app/members?removed=1");
}

export async function acceptInviteAction(form: FormData) {
  const { supabase } = await getContext();
  const code = z.string().trim().min(8).max(64).regex(/^[a-zA-Z0-9]+$/).safeParse(form.get("code"));
  if (!code.success) redirect("/app/join?error=invalid");
  const { data, error } = await supabase.rpc("accept_invite", { p_code: code.data });
  if (error) redirect(`/app/join?error=${encodeURIComponent(/not valid or has expired/.test(error.message) ? "This invitation is not valid or has expired. Ask for a new one." : "Something went wrong. Try again.")}`);
  await setActive(data as string);
  revalidatePath("/app", "layout");
  redirect("/app?joined=1");
}

function memberError(message: string): string {
  if (/function .* does not exist|could not find the function/i.test(message)) return "Sharing is not available on this server yet.";
  if (/permission/i.test(message) || /Only the owner|Only an admin/i.test(message)) return message.replace(/^.*?: /, "");
  if (/^[A-Z][^{}]{5,120}$/.test(message)) return message;
  return "Something went wrong. Try again.";
}
