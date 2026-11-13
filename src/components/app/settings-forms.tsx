"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { requestPasswordReset, type FormState } from "@/app/(auth)/actions";
import {
  changePasswordAction,
  deleteAccountAction,
  removeAvatarAction,
  requestEmailChangeAction,
  saveAvatarAction,
  signOutEverywhereAction,
  signOutOthersAction,
  unlinkProviderAction,
  updateNotificationsAction,
  updatePreferencesAction,
  updateProfileAction,
  type SettingsState,
} from "@/app/app/settings-actions";
import { Avatar } from "@/components/app/AccountMenu";
import { Field, FormMessage, PasswordField, SubmitButton } from "@/components/auth/fields";
import { COMMON_TIMEZONES, CURRENCIES } from "@/config/categories";
import { COUNTRIES, DATE_FORMATS, NUMBER_FORMATS, PERSONAS } from "@/config/profile-options";
import { DASHBOARD_SECTIONS, NOTIFICATION_KEYS, type NotificationKey } from "@/domain/profile";
import { oauthMessage } from "@/lib/auth/oauth-errors";
import { SOCIAL_PROVIDERS, type SocialProvider } from "@/lib/auth/providers";
import { createClient } from "@/lib/supabase/client";
import { SelectField } from "./controls";

type Act = (s: SettingsState | undefined, f: FormData) => Promise<SettingsState>;
const useAct = (a: Act) => useActionState<SettingsState | undefined, FormData>(a, undefined);
const tz = COMMON_TIMEZONES.map((z) => ({ value: z, label: z.replace("_", " ") }));

/** A switch that submits as an ordinary checkbox, so it works in a plain form and with the keyboard. */
export function Toggle({ name, label, hint, defaultChecked, disabled }: { name: string; label: string; hint?: string; defaultChecked?: boolean; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 py-2.5 ${disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-line-strong transition-colors peer-checked:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-sm text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

// ───────────────────────── profile ─────────────────────────
export interface ProfileValues {
  name: string;
  country: string;
  persona: string;
  currency: string;
  timezone: string;
  dateFormat: string;
  phone: string;
}

export function ProfileForm({ initial }: { initial: ProfileValues }) {
  const [s, action] = useAct(updateProfileAction);
  const fe = s?.fieldErrors ?? {};
  const v = s?.values ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormMessage error={s?.error} notice={s?.notice} />
      <Field label="Full name" name="name" autoComplete="name" defaultValue={v.name ?? initial.name} error={fe.name} />
      <SelectField label="Country" name="country" placeholder="Choose your country" defaultValue={v.country ?? initial.country} error={fe.country} options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))} />
      <SelectField label="How will you use FinTrack?" name="persona" placeholder="Choose one" defaultValue={v.persona ?? initial.persona} error={fe.persona} options={PERSONAS.map((p) => ({ value: p.value, label: p.label }))} />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Preferred currency" name="currency" defaultValue={v.currency ?? initial.currency} error={fe.currency} options={CURRENCIES.map((c) => ({ value: c.code, label: c.label }))} />
        <SelectField label="Timezone" name="timezone" defaultValue={v.timezone ?? initial.timezone} error={fe.timezone} options={tz} />
      </div>
      <SelectField label="Date format" name="date_format" placeholder="Choose a format" defaultValue={v.date_format ?? initial.dateFormat} error={fe.date_format} options={DATE_FORMATS.map((d) => ({ value: d.value, label: `${d.label} (${d.example})` }))} />
      <Field label="Phone number (optional)" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={v.phone ?? initial.phone} error={fe.phone} hint="Used only to help you recover your account. We never share it." />
      <SubmitButton compact pendingLabel="Saving">
        Save profile
      </SubmitButton>
    </form>
  );
}

const MAX_AVATAR = 2 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function AvatarUploader({ userId, name, url }: { userId: string; name: string; url: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; notice?: string }>({});

  async function onFile(file: File | undefined) {
    if (!file) return;
    setMsg({});
    const ext = AVATAR_TYPES[file.type];
    if (!ext) return setMsg({ error: "Choose a JPG, PNG or WebP image." });
    if (file.size > MAX_AVATAR) return setMsg({ error: "That image is over 2 MB. Choose a smaller one." });
    const supabase = createClient();
    if (!supabase) return setMsg({ error: "Uploads are not available right now." });
    setBusy(true);
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("budgetbuddy-avatars").upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      setBusy(false);
      return setMsg({ error: "The upload failed. Check your connection and try again." });
    }
    const res = await saveAvatarAction(path);
    setBusy(false);
    setMsg(res);
    if (!res.error) router.refresh();
  }

  async function remove() {
    setBusy(true);
    const res = await removeAvatarAction();
    setBusy(false);
    setMsg(res);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} url={url} size={72} />
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className="rounded-full border border-line-strong bg-surface px-4 py-1.5 text-sm font-medium transition-colors hover:border-primary disabled:opacity-60">
            {busy ? "Working" : url ? "Change photo" : "Upload photo"}
          </button>
          {url ? (
            <button type="button" onClick={remove} disabled={busy} className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-fg disabled:opacity-60">
              Remove
            </button>
          ) : null}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Profile photo file" onChange={(e) => onFile(e.target.files?.[0])} />
        <p className="text-xs text-muted">JPG, PNG or WebP, up to 2 MB. Stored privately and shown only to you.</p>
        {msg.error ? (
          <p role="alert" className="text-sm text-neg-text">
            {msg.error}
          </p>
        ) : msg.notice ? (
          <p role="status" className="text-sm text-pos-text">
            {msg.notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function EmailChangeForm({ email, pendingEmail, verified, needsPassword }: { email: string; pendingEmail: string | null; verified: boolean; needsPassword: boolean }) {
  const [s, action] = useAct(requestEmailChangeAction);
  const [open, setOpen] = useState(false);
  const fe = s?.fieldErrors ?? {};
  return (
    <div className="space-y-3">
      <Field label="Email address" name="current_email" type="email" defaultValue={email} readOnly hint={verified ? "Verified. This is the address you sign in with." : "Not verified yet. Check your inbox for the confirmation link."} />
      {pendingEmail ? <p className="text-sm text-warn-text">A change to {pendingEmail} is waiting for confirmation. Open the link we emailed to finish it.</p> : null}
      {!open && !s?.notice ? (
        <button type="button" onClick={() => setOpen(true)} className="text-sm text-primary hover:underline">
          Change email address
        </button>
      ) : (
        <form action={action} className="space-y-4 rounded-xl border border-line bg-sunken p-4" noValidate>
          <FormMessage error={s?.error} notice={s?.notice} />
          {s?.needsReauth ? (
            <a href="/login?next=/app/settings" className="text-sm text-primary hover:underline">
              Sign in again
            </a>
          ) : null}
          <Field label="New email address" name="email" type="email" autoComplete="email" defaultValue={s?.values?.email} error={fe.email} />
          {needsPassword ? <PasswordField label="Your password" name="password" autoComplete="current-password" error={fe.password} /> : null}
          <p className="text-xs text-muted">We email a link to the new address. Your sign-in address does not change until you open it.</p>
          <SubmitButton compact pendingLabel="Sending">
            Send confirmation link
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

// ───────────────────────── preferences and notifications ─────────────────────────
export function PreferencesForm({
  initial,
}: {
  initial: { theme: string; currency: string; timezone: string; dateFormat: string; numberFormat: string; dashboard: Record<string, boolean> };
}) {
  const [s, action] = useAct(updatePreferencesAction);
  const fe = s?.fieldErrors ?? {};
  const v = s?.values ?? {};
  return (
    <form action={action} className="space-y-8" noValidate>
      <FormMessage error={s?.error} notice={s?.notice} />
      <section className="space-y-5" aria-labelledby="look">
        <h2 id="look" className="font-semibold">
          Appearance and formats
        </h2>
        <SelectField label="Theme" name="theme" defaultValue={v.theme ?? initial.theme} error={fe.theme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "Match my device" }]} />
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField label="Preferred currency" name="currency" defaultValue={v.currency ?? initial.currency} error={fe.currency} options={CURRENCIES.map((c) => ({ value: c.code, label: c.label }))} />
          <SelectField label="Timezone" name="timezone" defaultValue={v.timezone ?? initial.timezone} error={fe.timezone} options={tz} />
          <SelectField label="Date format" name="date_format" defaultValue={v.date_format ?? initial.dateFormat} error={fe.date_format} options={[{ value: "", label: "Not set (day first)" }, ...DATE_FORMATS.map((d) => ({ value: d.value, label: `${d.label} (${d.example})` }))]} />
          <SelectField label="Number format" name="number_format" defaultValue={v.number_format ?? initial.numberFormat} error={fe.number_format} options={NUMBER_FORMATS.map((n) => ({ value: n.value, label: `${n.label} (${n.example})` }))} />
        </div>
        <p className="text-sm text-muted">The currency here is your default for new spaces. A space keeps the currency it was created with, so existing records never change.</p>
      </section>
      <section aria-labelledby="dash">
        <h2 id="dash" className="font-semibold">
          Dashboard
        </h2>
        <p className="mb-1 text-sm text-muted">Choose what appears on your dashboard. Your summary figures always show.</p>
        <div className="divide-y divide-line">
          {DASHBOARD_SECTIONS.map((sec) => (
            <Toggle key={sec.key} name={`dash_${sec.key}`} label={sec.label} defaultChecked={initial.dashboard[sec.key]} />
          ))}
        </div>
      </section>
      <SubmitButton compact pendingLabel="Saving">
        Save preferences
      </SubmitButton>
    </form>
  );
}

export function NotificationsForm({ initial }: { initial: Record<NotificationKey, boolean> }) {
  const [s, action] = useAct(updateNotificationsAction);
  return (
    <form action={action} className="space-y-6" noValidate>
      <FormMessage error={s?.error} notice={s?.notice} />
      <div className="divide-y divide-line">
        {NOTIFICATION_KEYS.map((k) => (
          <Toggle key={k.key} name={k.key} label={k.label} hint={k.hint} defaultChecked={initial[k.key]} />
        ))}
        <Toggle name="security" label="Security notices" hint="Sign-in, password and email changes. Always on, because they protect your account." defaultChecked disabled />
      </div>
      <SubmitButton compact pendingLabel="Saving">
        Save choices
      </SubmitButton>
    </form>
  );
}

// ───────────────────────── security ─────────────────────────
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [s, action] = useAct(changePasswordAction);
  const fe = s?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={s?.error} notice={s?.notice} />
      {s?.needsReauth ? (
        <a href="/login?next=/app/settings/security" className="text-sm text-primary hover:underline">
          Sign in again
        </a>
      ) : null}
      {hasPassword ? <PasswordField label="Current password" name="current" autoComplete="current-password" error={fe.current} /> : <p className="text-sm text-muted">You sign in with a provider or email link. Set a password to also sign in with email and password.</p>}
      <PasswordField label="New password" name="password" autoComplete="new-password" showStrength error={fe.password} />
      <PasswordField label="Confirm new password" name="confirm" autoComplete="new-password" error={fe.confirm} />
      <SubmitButton compact pendingLabel="Saving">
        {hasPassword ? "Change password" : "Set password"}
      </SubmitButton>
    </form>
  );
}

export function ResetLinkForm({ email }: { email: string }) {
  const [s, action] = useActionState<FormState | undefined, FormData>(requestPasswordReset, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="email" value={email} />
      <FormMessage error={s?.error} notice={s?.notice} />
      <SubmitButton compact pendingLabel="Sending">
        Email me a password reset link
      </SubmitButton>
    </form>
  );
}

export function SessionActions() {
  const [others, othersAction] = useAct(signOutOthersAction);
  return (
    <div className="space-y-4">
      <form action={othersAction} className="space-y-2">
        <FormMessage error={others?.error} notice={others?.notice} />
        <button type="submit" className="rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-primary">
          Sign out other devices
        </button>
      </form>
      <form action={signOutEverywhereAction}>
        <button type="submit" className="rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-primary">
          Sign out everywhere, including here
        </button>
      </form>
    </div>
  );
}

// ───────────────────────── connected accounts ─────────────────────────
export interface ConnectedIdentity {
  provider: string;
  label: string;
  detail: string | null;
  canUnlink: boolean;
  reason?: string;
}

function UnlinkForm({ provider, label }: { provider: string; label: string }) {
  const [s, action] = useAct(unlinkProviderAction);
  const [confirm, setConfirm] = useState(false);
  return (
    <form action={action} className="space-y-1.5 text-right">
      <input type="hidden" name="provider" value={provider} />
      {confirm ? (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted">Disconnect {label}?</span>
          <button type="submit" className="rounded-full bg-neg px-3 py-1 text-sm font-semibold text-white">
            Disconnect
          </button>
          <button type="button" onClick={() => setConfirm(false)} className="text-sm text-muted hover:text-fg">
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="text-sm text-primary hover:underline">
          Disconnect
        </button>
      )}
      {s?.error ? (
        <p role="alert" className="text-sm text-neg-text">
          {s.error}
        </p>
      ) : null}
    </form>
  );
}

export function ConnectedAccounts({ identities, linkable, error }: { identities: ConnectedIdentity[]; linkable: SocialProvider[]; error?: string }) {
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const connected = new Set(identities.map((i) => i.provider));

  async function link(provider: SocialProvider) {
    setLinkError(null);
    setBusy(provider);
    const supabase = createClient();
    if (!supabase) {
      setBusy(null);
      return setLinkError(oauthMessage("unavailable"));
    }
    const redirectTo = `${window.location.origin}/auth/callback?provider=${provider}&next=${encodeURIComponent("/app/settings/connected")}`;
    const { error: err } = await supabase.auth.linkIdentity({ provider, options: { redirectTo } });
    if (err) {
      setBusy(null);
      setLinkError(/manual linking|linking is disabled/i.test(err.message) ? "Connecting accounts is not switched on for this project yet." : oauthMessage(/not enabled/i.test(err.message) ? "disabled" : "failed", provider));
    }
  }

  const available = SOCIAL_PROVIDERS.filter((p) => linkable.includes(p.id) && !connected.has(p.id));
  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded-md border border-neg/50 bg-neg/10 px-3 py-2.5 text-sm text-neg-text">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {identities.map((i) => (
          <li key={i.provider} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{i.label}</p>
              {i.detail ? <p className="truncate text-sm text-muted">{i.detail}</p> : null}
            </div>
            {i.canUnlink ? <UnlinkForm provider={i.provider} label={i.label} /> : <p className="max-w-[16rem] text-right text-xs text-muted">{i.reason ?? "Cannot be disconnected."}</p>}
          </li>
        ))}
      </ul>
      {available.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Connect another way to sign in</h3>
          <div className="flex flex-wrap gap-3">
            {available.map((p) => (
              <button key={p.id} type="button" onClick={() => link(p.id)} disabled={busy !== null} aria-busy={busy === p.id} className="rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-primary disabled:opacity-60">
                {busy === p.id ? `Opening ${p.label}` : `Connect ${p.label}`}
              </button>
            ))}
          </div>
          {linkError ? (
            <p role="alert" className="text-sm text-neg-text">
              {linkError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ───────────────────────── account deletion ─────────────────────────
export function DeleteAccountForm({ needsPassword, blocked }: { needsPassword: boolean; blocked: boolean }) {
  const [s, action] = useAct(deleteAccountAction);
  const fe = s?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={s?.error} />
      {s?.needsReauth ? (
        <a href="/login?next=/app/settings/privacy" className="text-sm text-primary hover:underline">
          Sign in again
        </a>
      ) : null}
      {needsPassword ? <PasswordField label="Your password" name="password" autoComplete="current-password" error={fe.password} /> : null}
      <Field label="Type DELETE to confirm" name="confirm" autoComplete="off" error={fe.confirm} />
      <button type="submit" disabled={blocked} className="rounded-full bg-neg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
        Permanently delete my account data
      </button>
      {blocked ? <p className="text-sm text-muted">Resolve the shared spaces above first.</p> : null}
    </form>
  );
}
