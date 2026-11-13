"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signUp,
  updatePassword,
  type FormState,
} from "@/app/(auth)/actions";
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

export function GoogleButton({ next }: { next?: string }) {
  async function go() {
    const supabase = createClient();
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next ?? "/app")}` },
    });
  }
  return (
    <button
      type="button"
      onClick={go}
      className="w-full rounded-md border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:border-primary"
    >
      Continue with Google
    </button>
  );
}
