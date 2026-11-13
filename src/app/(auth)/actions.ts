"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isRecoveryTokenValid, RECOVERY_COOKIE } from "@/lib/auth/recovery-guard";
import { safeNext } from "@/lib/auth/safe-redirect";
import { passwordProblems } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";

export interface FormState {
  error?: string;
  notice?: string;
  fieldErrors?: Partial<Record<"email" | "password" | "confirm" | "name", string>>;
  /** Echoed back so a failed submit does not clear what the user typed. */
  email?: string;
  name?: string;
}

const NOT_CONFIGURED: FormState = {
  error: "Sign-in is not available right now because the service is not configured. Please try again later.",
};

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
const password = z.string().min(1, "Enter your password.");
const newPassword = z.string().superRefine((v, ctx) => {
  for (const msg of passwordProblems(v)) ctx.addIssue({ code: "custom", message: msg });
});

async function siteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function flatten(err: z.ZodError): FormState["fieldErrors"] {
  const out: NonNullable<FormState["fieldErrors"]> = {};
  for (const issue of err.issues) {
    const key = issue.path[0] as keyof NonNullable<FormState["fieldErrors"]>;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

/** Maps provider errors to messages that say what to do, without leaking internals. */
function authMessage(code: string | undefined, status: number | undefined): string {
  if (code === "invalid_credentials") return "The email or password is incorrect. Check them and try again, or reset your password.";
  if (code === "email_not_confirmed") return "Confirm your email first. We sent you a link when you signed up.";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429)
    return "Too many attempts. Wait a few minutes before trying again.";
  if (code === "user_banned") return "This account is disabled. Contact support if you think this is a mistake.";
  if (code === "weak_password") return "That password is too weak or has appeared in a data breach. Choose a different one.";
  return "Something went wrong. Check your connection and try again.";
}

async function finishSignIn(provider: "email" | "google") {
  const supabase = (await createClient())!;
  await supabase.rpc("ensure_profile");
  // A per-browser hint only: it stores the provider name, never an email.
  (await cookies()).set("bb-last-provider", provider, { maxAge: 60 * 60 * 24 * 180, sameSite: "lax", path: "/", httpOnly: true });
}

export async function signIn(_: FormState | undefined, form: FormData): Promise<FormState> {
  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;
  const parsed = z.object({ email, password }).safeParse(Object.fromEntries(form));
  const raw = String(form.get("email") ?? "");
  if (!parsed.success) return { fieldErrors: flatten(parsed.error), email: raw };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authMessage(error.code, error.status), email: raw };
  await finishSignIn("email");
  redirect(safeNext(String(form.get("next") ?? "")));
}

export async function signUp(_: FormState | undefined, form: FormData): Promise<FormState> {
  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;
  const schema = z
    .object({
      name: z.string().trim().min(1, "Enter your name.").max(80),
      email,
      password: newPassword,
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords do not match." });
  const raw = String(form.get("email") ?? "");
  const rawName = String(form.get("name") ?? "");
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: flatten(parsed.error), email: raw, name: rawName };

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.name },
      emailRedirectTo: `${await siteUrl()}/auth/confirm?next=/app`,
    },
  });
  if (error) return { error: authMessage(error.code, error.status), email: raw, name: rawName };

  if (data.session) {
    // Email confirmation is off for this project: the user is already signed in.
    await supabase.rpc("ensure_profile");
    await supabase.from("profiles").update({ display_name: parsed.data.name }).eq("user_id", data.user!.id);
    redirect("/app");
  }
  // Same message whether or not the address was already registered.
  return { notice: "Check your email. We sent a link to confirm your address and finish creating your account.", email: raw, name: rawName };
}

export async function requestPasswordReset(_: FormState | undefined, form: FormData): Promise<FormState> {
  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { fieldErrors: { email: "Enter a valid email address." }, email: String(form.get("email") ?? "") };

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/reset-password`,
  });
  // Only rate limiting is surfaced; everything else gets the generic message so
  // the response never reveals whether an account exists.
  if (error && (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit" || error.status === 429)) {
    return { error: authMessage(error.code, error.status), email: parsed.data };
  }
  return { notice: "If an account exists for that address, we sent a link to reset the password. It expires in an hour.", email: parsed.data };
}

export async function updatePassword(_: FormState | undefined, form: FormData): Promise<FormState> {
  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;
  const { data: user } = await supabase.auth.getUser();
  const expired: FormState = { error: "This reset link has expired or was already used. Request a new one." };
  if (!user.user) return expired;
  // Only a session created by verifying a reset link may set a new password.
  // An ordinary signed-in session (or another app's) must never reach updateUser here.
  const token = (await cookies()).get(RECOVERY_COOKIE)?.value;
  if (!isRecoveryTokenValid(token, user.user.id, Date.now())) return expired;

  const parsed = z
    .object({ password: newPassword, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords do not match." })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { fieldErrors: flatten(parsed.error) };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: authMessage(error.code, error.status) };
  // Revoke every other session so a stolen session cannot outlive the reset.
  await supabase.auth.signOut({ scope: "others" });
  (await cookies()).delete(RECOVERY_COOKIE);
  redirect("/app");
}

export async function resendConfirmation(_: FormState | undefined, form: FormData): Promise<FormState> {
  const supabase = await createClient();
  if (!supabase) return NOT_CONFIGURED;
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { fieldErrors: { email: "Enter a valid email address." } };
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: `${await siteUrl()}/auth/confirm?next=/app` },
  });
  if (error && error.status === 429) return { error: authMessage(error.code, error.status) };
  return { notice: "If that address is waiting for confirmation, we sent a new link.", email: parsed.data };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase?.auth.signOut();
  redirect("/");
}
