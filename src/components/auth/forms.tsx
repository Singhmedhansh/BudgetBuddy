"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  requestMagicLink,
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signUp,
  updatePassword,
  type FormState,
} from "@/app/(auth)/actions";
import { oauthMessage } from "@/lib/auth/oauth-errors";
import { SOCIAL_PROVIDERS, type SocialProvider } from "@/lib/auth/providers";
import { createClient } from "@/lib/supabase/client";
import { Field, FormMessage, PasswordField, SubmitButton } from "./fields";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action] = useActionState<FormState | undefined, FormData>(signIn, undefined);
  const [resend, resendAction] = useActionState<FormState | undefined, FormData>(resendConfirmation, undefined);
  const needsConfirm = state?.error?.startsWith("Confirm your email");
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next ?? ""} />
        <FormMessage error={state?.error} notice={notice} />
        <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={state?.email} error={state?.fieldErrors?.email} />
        <PasswordField label="Password" name="password" autoComplete="current-password" error={state?.fieldErrors?.password} />
        <div className="text-right">
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            Forgot your password?
          </Link>
        </div>
        <SubmitButton pendingLabel="Signing in">Sign in</SubmitButton>
      </form>
      {needsConfirm ? (
        <form action={resendAction} className="space-y-3 rounded-md border border-line bg-sunken p-4">
          <input type="hidden" name="email" value={state?.email ?? ""} />
          <FormMessage error={resend?.error} notice={resend?.notice} />
          <SubmitButton pendingLabel="Sending">Send a new confirmation link</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

export function SignupForm() {
  const [state, action] = useActionState<FormState | undefined, FormData>(signUp, undefined);
  if (state?.notice) {
    return <FormMessage notice={state.notice} />;
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={state?.error} />
      <Field label="Name" name="name" autoComplete="name" defaultValue={state?.name} error={state?.fieldErrors?.name} />
      <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={state?.email} error={state?.fieldErrors?.email} />
      <PasswordField label="Password" name="password" autoComplete="new-password" showStrength error={state?.fieldErrors?.password} />
      <PasswordField label="Confirm password" name="confirm" autoComplete="new-password" error={state?.fieldErrors?.confirm} />
      <SubmitButton pendingLabel="Creating account">Create account</SubmitButton>
      <p className="text-xs leading-relaxed text-muted">
        By creating an account you agree to the{" "}
        <Link href="/legal/terms" className="underline">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState<FormState | undefined, FormData>(requestPasswordReset, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={state?.error} notice={state?.notice} />
      <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={state?.email} error={state?.fieldErrors?.email} />
      <SubmitButton pendingLabel="Sending">{state?.notice ? "Send again" : "Send reset link"}</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState<FormState | undefined, FormData>(updatePassword, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={state?.error} />
      {state?.error?.includes("expired") ? (
        <Link href="/forgot-password" className="inline-block text-sm text-primary hover:underline">
          Request a new link
        </Link>
      ) : null}
      <PasswordField label="New password" name="password" autoComplete="new-password" showStrength error={state?.fieldErrors?.password} />
      <PasswordField label="Confirm new password" name="confirm" autoComplete="new-password" error={state?.fieldErrors?.confirm} />
      <SubmitButton pendingLabel="Saving">Save new password</SubmitButton>
    </form>
  );
}

const MARKS: Record<SocialProvider, React.ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8H1.4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.7 1.8l3.5-3.5A12 12 0 0 0 1.4 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  ),
};

/** One button per provider that is actually enabled. Each shows its own loading state and never leaves a dead click. */
export function SocialButtons({ providers, next, lastUsed, verb = "Continue" }: { providers: SocialProvider[]; next?: string; lastUsed?: string; verb?: string }) {
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (providers.length === 0) return null;

  async function go(provider: SocialProvider) {
    setError(null);
    setBusy(provider);
    const supabase = createClient();
    if (!supabase) {
      setBusy(null);
      setError(oauthMessage("unavailable"));
      return;
    }
    const target = `${window.location.origin}/auth/callback?provider=${provider}&next=${encodeURIComponent(next || "/app")}`;
    const { error: err } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: target } });
    // On success the browser is already navigating away; only a failure comes back here.
    if (err) {
      setBusy(null);
      setError(oauthMessage(/not enabled/i.test(err.message) ? "disabled" : "failed", provider));
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3">
        {SOCIAL_PROVIDERS.filter((p) => providers.includes(p.id)).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => go(p.id)}
            disabled={busy !== null}
            aria-busy={busy === p.id}
            className="relative flex w-full items-center justify-center gap-2.5 rounded-full border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold transition-all hover:-translate-y-px hover:border-primary hover:shadow-card disabled:cursor-wait disabled:opacity-70"
          >
            {busy === p.id ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-primary" /> : MARKS[p.id]}
            {busy === p.id ? "Opening " + p.label : `${verb} with ${p.label}`}
            {lastUsed === p.id && busy === null ? <span className="absolute right-4 text-xs font-normal text-muted">Last used</span> : null}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-neg-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Passwordless sign-in. The answer is the same for known and unknown addresses. */
export function MagicLinkForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState | undefined, FormData>(requestMagicLink, undefined);
  const [open, setOpen] = useState(false);
  if (!open && !state?.notice) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full text-center text-sm text-primary hover:underline">
        Email me a sign-in link instead
      </button>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-xl border border-line bg-sunken p-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <p className="text-sm text-muted">We will email you a link that signs you in. No password needed.</p>
      <FormMessage error={state?.error} notice={state?.notice} />
      <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={state?.email} error={state?.fieldErrors?.email} />
      <SubmitButton pendingLabel="Sending">{state?.notice ? "Send again" : "Email me a link"}</SubmitButton>
    </form>
  );
}
