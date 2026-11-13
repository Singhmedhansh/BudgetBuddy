"use client";

import { useActionState } from "react";
import { deleteMyDataAction, updateProfileAction, type SettingsState } from "@/app/app/settings-actions";
import { Field, FormMessage, SubmitButton } from "@/components/auth/fields";
import { COMMON_TIMEZONES } from "@/config/categories";
import { SelectField } from "./controls";

export function ProfileForm({ name, timezone }: { name: string; timezone: string }) {
  const [s, action] = useActionState<SettingsState | undefined, FormData>(updateProfileAction, undefined);
  const fe = s?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage error={s?.error} notice={s?.notice} />
      <Field label="Name" name="name" autoComplete="name" defaultValue={s?.values?.name ?? name} error={fe.name} />
      <SelectField label="Timezone" name="timezone" defaultValue={s?.values?.timezone ?? timezone} error={fe.timezone} options={COMMON_TIMEZONES.map((z) => ({ value: z, label: z.replace("_", " ") }))} />
      <SubmitButton pendingLabel="Saving">Save changes</SubmitButton>
    </form>
  );
}

export function DeleteDataForm() {
  const [s, action] = useActionState<SettingsState | undefined, FormData>(deleteMyDataAction, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={s?.error} />
      <Field label="Type DELETE to confirm" name="confirm" autoComplete="off" error={s?.fieldErrors?.confirm} />
      <button type="submit" className="rounded-full bg-neg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90">
        Delete my Budget Buddy data
      </button>
    </form>
  );
}
