"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COMMON_TIMEZONES } from "@/config/categories";
import { ACTIVE_SPACE_COOKIE, getContext } from "@/server/context";
import { fieldErrors } from "@/server/form-errors";

export interface SettingsState {
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}
const echo = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateProfileAction(_: SettingsState | undefined, form: FormData): Promise<SettingsState> {
  const { supabase, user } = await getContext();
  const parsed = z
    .object({
      name: z.string({ message: "Enter your name." }).trim().min(1, "Enter your name.").max(80, "Use 80 characters or fewer."),
      timezone: z.string({ message: "Choose a timezone." }).refine((tz) => COMMON_TIMEZONES.includes(tz) && validTimezone(tz), "Choose a timezone from the list."),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: echo(form) };
  const { error } = await supabase.from("profiles").update({ display_name: parsed.data.name, timezone: parsed.data.timezone, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  if (error) return { error: "Your changes could not be saved. Try again.", values: echo(form) };
  revalidatePath("/app", "layout");
  return { notice: "Saved. Dates and budget periods now follow this timezone.", values: echo(form) };
}

/** Removes the person's Budget Buddy data (their solely-owned spaces and profile) after they type DELETE. The sign-in account itself is untouched. */
export async function deleteMyDataAction(_: SettingsState | undefined, form: FormData): Promise<SettingsState> {
  const { supabase } = await getContext();
  if (String(form.get("confirm") ?? "").trim() !== "DELETE") return { fieldErrors: { confirm: "Type DELETE in capitals to confirm." } };
  const { error } = await supabase.rpc("delete_my_data");
  if (error) {
    if (/does not exist|could not find the function/i.test(error.message)) return { error: "Data deletion is not available on this server yet." };
    if (/still own a space/i.test(error.message)) return { error: "You still own a space that other people use. Remove them or leave ownership first, then try again." };
    return { error: "Your data could not be deleted. Nothing was changed. Try again." };
  }
  (await cookies()).delete(ACTIVE_SPACE_COOKIE);
  await supabase.auth.signOut();
  redirect("/?deleted=1");
}
