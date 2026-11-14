"use client";

import { Smartphone } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  requestMagicLink,
  requestPasswordReset,
  requestPhoneCode,
  resendConfirmation,
  signIn,
  signUp,
  updatePassword,
  verifyPhoneCode,
  type FormState,
  type PhoneState,
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
  apple: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  ),
};

const methodBtn =
  "relative flex w-full items-center justify-center gap-2.5 rounded-full border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold transition-all hover:-translate-y-px hover:border-primary hover:shadow-card disabled:cursor-wait disabled:opacity-70";

/** A thin rule with a word in the middle, between groups of sign-in methods. */
export function AuthDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted" role="separator">
      <span aria-hidden className="h-px flex-1 bg-line" />
      <span>{children}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * One button per provider that is actually enabled. Each shows its own loading state and never leaves a dead click.
 * One or two providers stack full width with the full wording; three or more sit two to a row so the page stays short.
 */
export function SocialButtons({ providers, next, lastUsed, verb = "Continue" }: { providers: SocialProvider[]; next?: string; lastUsed?: string; verb?: string }) {
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (providers.length === 0) return null;
  const shown = SOCIAL_PROVIDERS.filter((p) => providers.includes(p.id));
  const compact = shown.length >= 3;
  const oddFirst = compact && shown.length % 2 === 1; // an odd count: the first button spans the row

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
      <div className={compact ? "grid grid-cols-2 gap-3" : "grid gap-3"}>
        {shown.map((p, i) => {
          const wide = !compact || (oddFirst && i === 0);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => go(p.id)}
              disabled={busy !== null}
              aria-busy={busy === p.id}
              aria-label={`${verb} with ${p.label}`}
              className={`${methodBtn} ${oddFirst && i === 0 ? "col-span-2" : ""}`}
            >
              {busy === p.id ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-primary" /> : MARKS[p.id]}
              {busy === p.id ? "Opening " + p.label : wide ? `${verb} with ${p.label}` : p.label}
              {lastUsed === p.id && busy === null && wide ? <span className="absolute right-4 text-xs font-normal text-muted">Last used</span> : null}
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-neg-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Phone sign-in in two steps: ask for a number, then for the six-digit code that was texted to it. `mode` decides what
 * a number with no account does: on sign-up it creates one, on sign-in it does not.
 */
export function PhoneSignIn({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={methodBtn} aria-expanded={false}>
        <Smartphone size={18} aria-hidden />
        {mode === "signup" ? "Sign up with phone" : "Continue with phone"}
      </button>
    );
  }
  return <PhoneFlow key={attempt} mode={mode} next={next} onReset={() => setAttempt((n) => n + 1)} onClose={() => setOpen(false)} />;
}

function PhoneFlow({ mode, next, onReset, onClose }: { mode: "login" | "signup"; next?: string; onReset: () => void; onClose: () => void }) {
  const [asked, ask] = useActionState<PhoneState | undefined, FormData>(requestPhoneCode, undefined);
  const [checked, check] = useActionState<PhoneState | undefined, FormData>(verifyPhoneCode, undefined);
  const onCode = asked?.step === "code";
  return (
    <div className="space-y-4 rounded-xl border border-line bg-sunken p-4">
      {onCode ? (
        <>
          <FormMessage error={checked?.error} notice={asked?.notice} />
          <form action={check} className="space-y-3" noValidate>
            <input type="hidden" name="phone" value={asked?.phone ?? ""} />
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="next" value={next ?? ""} />
            <Field label="6-digit code" name="token" autoComplete="one-time-code" inputMode="numeric" />
            <SubmitButton pendingLabel="Checking">Verify and continue</SubmitButton>
          </form>
          <div className="flex items-center justify-between gap-3 text-sm">
            <form action={ask}>
              <input type="hidden" name="phone" value={asked?.phone ?? ""} />
              <input type="hidden" name="mode" value={mode} />
              <button type="submit" className="text-primary hover:underline">
                Send a new code
              </button>
            </form>
            <button type="button" onClick={onReset} className="text-muted hover:text-fg">
              Use a different number
            </button>
          </div>
        </>
      ) : (
        <form action={ask} className="space-y-3" noValidate>
          <input type="hidden" name="mode" value={mode} />
          <FormMessage error={asked?.error} />
          <Field label="Mobile number" name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={asked?.phone} hint="Include the country code, like +91 98765 43210. An Indian mobile number works without it." />
          <SubmitButton pendingLabel="Sending code">Text me a code</SubmitButton>
          <button type="button" onClick={onClose} className="w-full text-center text-sm text-muted hover:text-fg">
            Use another way
          </button>
        </form>
      )}
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
