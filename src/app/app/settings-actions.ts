"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COMMON_TIMEZONES, CURRENCIES } from "@/config/categories";
import { PERSONAS } from "@/config/profile-options";
import {
  BANNER_SNOOZE_DAYS,
  canUnlink,
  DASHBOARD_SECTIONS,
  isCountry,
  isDateFormat,
  isNumberFormat,
  normalizePhone,
  NOTIFICATION_KEYS,
  PHONE_RE,
  profileCompletion,
} from "@/domain/profile";
import { passwordProblems } from "@/lib/password";
import { createAdminClient, deleteAuthUserEnabled } from "@/server/admin";
import { hasPassword, signedInWithin, verifyPassword } from "@/server/account";
import { ACTIVE_SPACE_COOKIE, getContext } from "@/server/context";
import { fieldErrors } from "@/server/form-errors";
import { siteUrl } from "@/server/site-url";
import { removeUnder } from "@/server/storage-cleanup";

export interface SettingsState {
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  /** Set when the person must sign in again before the action can run. */
  needsReauth?: boolean;
}
/** What the person typed, sent back so a failed submit does not clear the form. Passwords and the delete confirmation are never echoed. */
const echo = (form: FormData) =>
  Object.fromEntries([...form.entries()].filter(([k, v]) => typeof v === "string" && !/password|current|confirm/i.test(k))) as Record<string, string>;
const str = (form: FormData, k: string) => String(form.get(k) ?? "");

const NOT_YET = "This setting is not available yet because the latest database update has not been applied.";
/** A missing column or function means migration 9 has not been applied; say so instead of a vague failure. */
function saveError(error: { code?: string; message?: string } | null): string {
  if (error && (error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST202" || error.code === "42883" || /schema cache|does not exist/i.test(error.message ?? ""))) return NOT_YET;
  return "Your changes could not be saved. Try again.";
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── theme ─────────────────────────
export async function saveThemeAction(theme: string): Promise<void> {
  const { supabase, user } = await getContext();
  if (theme !== "light" && theme !== "dark" && theme !== "system") return;
  await supabase.from("profiles").update({ theme, updated_at: new Date().toISOString() }).eq("user_id", user.id);
}

// ───────────────────────── profile ─────────────────────────
const profileSchema = z.object({
  name: z.string({ message: "Enter your name." }).trim().min(1, "Enter your name.").max(80, "Use 80 characters or fewer."),
  country: z.string({ message: "Choose your country." }).refine(isCountry, "Choose your country from the list."),
  persona: z.enum(PERSONAS.map((p) => p.value) as [string, ...string[]], { message: "Choose the option that fits you best." }),
  currency: z.string({ message: "Choose a currency." }).refine((c) => CURRENCIES.some((x) => x.code === c), "Choose a currency from the list."),
  timezone: z.string({ message: "Choose a timezone." }).refine((tz) => COMMON_TIMEZONES.includes(tz) && validTimezone(tz), "Choose a timezone from the list."),
  date_format: z.string({ message: "Choose a date format." }).refine(isDateFormat, "Choose a date format from the list."),
  phone: z.string().optional(),
});

/**
 * Saves the personal profile. Partial saves are allowed: a field left blank is simply still missing, and the profile
 * stays Pending until every required field is filled. Completion is recomputed from the stored values, never from
 * what the form claims.
 */
export async function updateProfileAction(_: SettingsState | undefined, form: FormData): Promise<SettingsState> {
  const { supabase, user, profile } = await getContext();
  const values = echo(form);
  const phoneRaw = normalizePhone(str(form, "phone"));
  const fe: Record<string, string> = {};
  if (phoneRaw && !PHONE_RE.test(phoneRaw)) fe.phone = "Enter a phone number like +91 98765 43210, or leave it blank.";

  // Required fields may be left blank to save part of the profile; anything provided must be valid.
  const given = (k: string) => str(form, k).trim() !== "";
  const parsed = profileSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    for (const [k, v] of Object.entries(fieldErrors(parsed.error))) if (given(k === "name" ? "name" : k)) fe[k] = v;
  }
  if (Object.keys(fe).length) return { fieldErrors: fe, values };

  const next = {
    display_name: given("name") ? str(form, "name").trim().slice(0, 80) : profile.display_name,
    country: given("country") ? str(form, "country") : (profile.country ?? null),
    persona: given("persona") ? str(form, "persona") : profile.persona,
    date_format: given("date_format") ? str(form, "date_format") : (profile.date_format ?? null),
    currency: given("currency") ? str(form, "currency") : profile.currency,
    timezone: given("timezone") ? str(form, "timezone") : profile.timezone,
    phone: phoneRaw || null,
  };
  const completion = profileCompletion({ ...next });
  const { error } = await supabase
    .from("profiles")
    .update({
      ...next,
      profile_completed_at: completion.status === "complete" ? (profile.profile_completed_at ?? new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
  if (error) return { error: saveError(error), values };
  revalidatePath("/app", "layout");
  return {
    notice: completion.status === "complete" ? "Saved. Your profile is complete." : `Saved. ${completion.missing.length} detail${completion.missing.length === 1 ? "" : "s"} left to finish your profile.`,
    values,
  };
}

export async function dismissProfileBannerAction(): Promise<void> {
  const { supabase, user } = await getContext();
  const until = new Date(Date.now() + BANNER_SNOOZE_DAYS * 864e5).toISOString();
  // Hides the reminder for a few days. It never touches completion: the profile stays Pending.
  await supabase.from("profiles").update({ banner_dismissed_until: until }).eq("user_id", user.id);
  revalidatePath("/app", "layout");
}

// ───────────────────────── avatar ─────────────────────────
const AVATAR_PATH = /^[0-9a-f-]{36}\/avatar-\d{10,14}\.(jpg|png|webp)$/;

/** The browser uploads the file straight to the person's own private folder; this records it after checking the path. */
export async function saveAvatarAction(path: string): Promise<SettingsState> {
  const { supabase, user, profile } = await getContext();
  if (!AVATAR_PATH.test(path) || !path.startsWith(`${user.id}/`)) return { error: "That image could not be used. Choose a JPG, PNG or WebP file under 2 MB." };
  const { data: found } = await supabase.storage.from("budgetbuddy-avatars").list(user.id, { search: path.split("/")[1] });
  if (!found?.some((f) => `${user.id}/${f.name}` === path)) return { error: "The upload did not finish. Try again." };
  const { error } = await supabase.from("profiles").update({ avatar_path: path, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  if (error) return { error: saveError(error) };
  if (profile.avatar_path && profile.avatar_path !== path) await supabase.storage.from("budgetbuddy-avatars").remove([profile.avatar_path]);
  revalidatePath("/app", "layout");
  return { notice: "Photo updated." };
}

export async function removeAvatarAction(): Promise<SettingsState> {
  const { supabase, user, profile } = await getContext();
  if (!profile.avatar_path) return {};
  const { error } = await supabase.from("profiles").update({ avatar_path: null, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  if (error) return { error: saveError(error) };
  await supabase.storage.from("budgetbuddy-avatars").remove([profile.avatar_path]);
  revalidatePath("/app", "layout");
  return { notice: "Photo removed." };
}

// ───────────────────────── preferences ─────────────────────────
export async function updatePreferencesAction(_: SettingsState | undefined, form: FormData): Promise<SettingsState> {
  const { supabase, user } = await getContext();
  const values = echo(form);
  const parsed = z
    .object({
      theme: z.enum(["light", "dark", "system"], { message: "Choose a theme." }),
      currency: z.string().refine((c) => CURRENCIES.some((x) => x.code === c), "Choose a currency from the list."),
      timezone: z.string().refine((tz) => COMMON_TIMEZONES.includes(tz) && validTimezone(tz), "Choose a timezone from the list."),
      // Blank means "not chosen yet": saving Preferences must not quietly complete the profile's date-format step.
      date_format: z.string().refine((v) => v === "" || isDateFormat(v), "Choose a date format from the list."),
      number_format: z.string().refine(isNumberFormat, "Choose a number format from the list."),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  // An unticked checkbox is simply absent from the form, so every section is written explicitly.
  const dashboard_prefs = Object.fromEntries(DASHBOARD_SECTIONS.map((s) => [s.key, form.get(`dash_${s.key}`) === "on"]));
  const { error } = await supabase
    .from("profiles")
    .update({ ...parsed.data, date_format: parsed.data.date_format || null, dashboard_prefs, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (error) return { error: saveError(error), values };
  revalidatePath("/app", "layout");
  return { notice: "Preferences saved. They apply on every device you sign in on.", values };
}

// ───────────────────────── notifications ─────────────────────────
export async function updateNotificationsAction(_: SettingsState | undefined, form: FormData): Promise<SettingsState> {
  const { supabase, user } = await getContext();
  const notification_prefs = Object.fromEntries(NOTIFICATION_KEYS.map((k) => [k.key, form.get(k.key) === "on"]));
  const { error } = await supabase.from("profiles").update({ notification_prefs, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  if (error) return { error: saveError(error) };
  revalidatePath("/app/settings/notifications");
  return { notice: "Notification choices saved." };
}

// ───────────────────────── email, password, sessions ─────────────────────────
export async function requestEmailChangeAction(_: SettingsState | undefined, form: FormData): Promise<SettingsState> {
  const { supabase, user } = await getContext();
  const parsed = z.string().trim().toLowerCase().email("Enter a valid email address.").safeParse(form.get("email"));
  if (!parsed.success) return { fieldErrors: { email: "Enter a valid email address." }, values: { email: str(form, "email") } };
  if (parsed.data === (user.email ?? "").toLowerCase()) return { fieldErrors: { email: "That is already your email address." }, values: { email: parsed.data } };
  // A password account must prove it knows the password before its sign-in address can change.
  if (hasPassword(user)) {
    if (!(await verifyPassword(user.email ?? "", str(form, "password")))) return { fieldErrors: { password: "That password is not correct." }, values: { email: parsed.data } };
  } else if (!signedInWithin(user, 10)) {
    return { error: "For your security, sign in again, then come back to change your email.", needsReauth: true, values: { email: parsed.data } };
  }
  const { error } = await supabase.auth.updateUser({ email: parsed.data }, { emailRedirectTo: `${await siteUrl()}/auth/confirm?next=/app/settings` });
  if (error) {
    if (error.status === 429 || /rate/i.test(error.code ?? "")) return { error: "Too many requests. Wait a few minutes before trying again.", values: { email: parsed.data } };
    if (error.code === "email_exists" || /already/i.test(error.message)) return { error: "Check the address and try again, or use a different one.", values: { email: parsed.data } };
    return { error: "We could not start the change. Try again.", values: { email: parsed.data } };
  }
  // Until the link in the email is opened the address does not change.
  return { notice: `We sent a confirmation link to ${parsed.data}. Your sign-in address stays ${user.email} until you open it. If your project asks for it, confirm from the old address too.`, values: { email: parsed.data } };
}

export async function changePasswordAction(_: SettingsState | undefined, form: FormData): Promise<SettingsState> {
  const { supabase, user } = await getContext();
  const next = str(form, "password");
  const problems = passwordProblems(next);
  const fe: Record<string, string> = {};
  if (problems.length) fe.password = problems[0];
  if (next !== str(form, "confirm")) fe.confirm = "The passwords do not match.";
  if (hasPassword(user)) {
    if (!str(form, "current")) fe.current = "Enter your current password.";
  } else if (!signedInWithin(user, 10)) {
    return { error: "For your security, sign in again, then come back to set a password.", needsReauth: true };
  }
  if (Object.keys(fe).length) return { fieldErrors: fe };
  if (hasPassword(user) && !(await verifyPassword(user.email ?? "", str(form, "current")))) return { fieldErrors: { current: "That password is not correct." } };
  if (hasPassword(user) && str(form, "current") === next) return { fieldErrors: { password: "Choose a password you have not used for this account." } };
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: error.code === "weak_password" ? "That password is too weak or has appeared in a data breach. Choose a different one." : "Your password could not be changed. Try again." };
  await supabase.auth.signOut({ scope: "others" }); // a changed password ends every other session
  return { notice: "Password updated. Other devices have been signed out." };
}

export async function signOutOthersAction(): Promise<SettingsState> {
  const { supabase } = await getContext();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  return error ? { error: "Could not sign out the other devices. Try again." } : { notice: "Every other device has been signed out." };
}

export async function signOutEverywhereAction(): Promise<void> {
  const { supabase } = await getContext();
  await supabase.auth.signOut({ scope: "global" });
  (await cookies()).delete(ACTIVE_SPACE_COOKIE);
  redirect("/login");
}

// ───────────────────────── connected accounts ─────────────────────────
export async function unlinkProviderAction(_: SettingsState | undefined, form: FormData): Promise<SettingsState> {
  const { supabase } = await getContext();
  const provider = str(form, "provider");
  const { data } = await supabase.auth.getUserIdentities();
  const identities = data?.identities ?? [];
  const check = canUnlink(identities, provider);
  if (!check.ok) return { error: check.reason };
  const target = identities.find((i) => i.provider === provider)!;
  const { error } = await supabase.auth.unlinkIdentity(target);
  if (error) return { error: "That sign-in method could not be disconnected. Try again." };
  revalidatePath("/app/settings/connected");
  return { notice: "Disconnected." };
}

// ───────────────────────── account deletion ─────────────────────────
/**
 * Deletes the person's FinTrack data after re-authentication. Order matters so nothing is left half done:
 * 1. confirmation and re-authentication, 2. refuse while a shared space still depends on the person as owner,
 * 3. remove stored files (any failure stops here, before any database row is touched), 4. delete the database
 * rows in one transaction, 5. only if explicitly enabled, remove the sign-in identity, 6. sign out.
 */
export async function deleteAccountAction(_: SettingsState | undefined, form: FormData): Promise<SettingsState> {
  const { supabase, user } = await getContext();
  if (str(form, "confirm").trim() !== "DELETE") return { fieldErrors: { confirm: "Type DELETE in capitals to confirm." } };

  if (hasPassword(user)) {
    if (!(await verifyPassword(user.email ?? "", str(form, "password")))) return { fieldErrors: { password: "That password is not correct." } };
  } else if (!signedInWithin(user, 10)) {
    return { error: "For your security, sign in again, then come straight back here to delete your account.", needsReauth: true };
  }

  const { data: blockers, error: blockErr } = await supabase.rpc("deletion_blockers");
  if (blockErr) return { error: /does not exist|schema cache/i.test(blockErr.message) ? "Account deletion is not available on this server yet." : "We could not check your shared spaces. Nothing was deleted. Try again." };
  if (blockers && blockers.length > 0) {
    const names = (blockers as { space_name: string }[]).map((b) => b.space_name).join(", ");
    return { error: `You still own ${names}, which other people use. Transfer ownership or remove them from Members first. Nothing was deleted.` };
  }

  try {
    const { data: owned } = await supabase.from("financial_space_members").select("space_id").eq("user_id", user.id).eq("role", "owner");
    const spaceIds = (owned ?? []).map((r) => r.space_id as string);
    await removeUnder(supabase.storage, "budgetbuddy-receipts", spaceIds);
    await removeUnder(supabase.storage, "budgetbuddy-imports", spaceIds);
    await removeUnder(supabase.storage, "budgetbuddy-avatars", [user.id]);
    const admin = createAdminClient();
    if (admin) await removeUnder(admin.storage, "budgetbuddy-support", [user.id]);
  } catch {
    return { error: "We could not remove your stored files, so nothing was deleted. Try again in a moment." };
  }

  const { error } = await supabase.rpc("delete_my_data");
  if (error) return { error: /still own a space/i.test(error.message) ? "You still own a space that other people use. Nothing was deleted." : "Your data could not be deleted. Nothing was changed. Try again." };

  let identityRemoved = false;
  if (deleteAuthUserEnabled()) {
    const admin = createAdminClient();
    if (admin) identityRemoved = !(await admin.auth.admin.deleteUser(user.id)).error;
  }
  (await cookies()).delete(ACTIVE_SPACE_COOKIE);
  await supabase.auth.signOut();
  redirect(identityRemoved ? "/login?deleted=1" : "/login?deleted=data");
}
