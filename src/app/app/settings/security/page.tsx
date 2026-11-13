import type { Metadata } from "next";
import { PasswordForm, ResetLinkForm, SessionActions } from "@/components/app/settings-forms";
import { formatDate } from "@/components/app/ui";
import { hasPassword } from "@/server/account";
import { getContext } from "@/server/context";

export const metadata: Metadata = { title: "Security" };

const METHOD: Record<string, string> = { email: "Email and password", google: "Google", github: "GitHub" };

export default async function SecurityPage() {
  const { user, profile } = await getContext();
  const password = hasPassword(user);
  const methods = (user.identities ?? []).map((i) => METHOD[i.provider] ?? i.provider);
  const lastSignIn = user.last_sign_in_at ? formatDate(user.last_sign_in_at, profile.timezone) : "unknown";
  return (
    <>
      <section aria-labelledby="overview">
        <h2 id="overview" className="mb-4 font-semibold">
          Account security
        </h2>
        <dl className="divide-y divide-line rounded-xl border border-line text-sm">
          {[
            ["Email", user.email ?? ""],
            ["Email verified", user.email_confirmed_at ? "Yes" : "Not yet. Check your inbox for the confirmation link."],
            ["Password", password ? "Set" : "Not set. You sign in with a provider or email link."],
            ["Sign-in methods", methods.join(", ") || "None"],
            ["This device signed in", lastSignIn],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-wrap justify-between gap-x-6 gap-y-1 px-4 py-3">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">We never show or store your password, and sign-in tokens are never displayed.</p>
      </section>

      <section aria-labelledby="pw">
        <h2 id="pw" className="mb-4 font-semibold">
          {password ? "Change password" : "Set a password"}
        </h2>
        <PasswordForm hasPassword={password} />
      </section>

      {password ? (
        <section aria-labelledby="reset">
          <h2 id="reset" className="mb-2 font-semibold">
            Forgot your password?
          </h2>
          <p className="mb-4 text-sm text-muted">We will email a reset link to {user.email}. It expires in an hour.</p>
          <ResetLinkForm email={user.email ?? ""} />
        </section>
      ) : null}

      <section aria-labelledby="sessions">
        <h2 id="sessions" className="mb-2 font-semibold">
          Devices and sessions
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-muted">
          You are signed in on this device. If you lost a device or used a shared computer, sign out the others. A list of individual devices is not available, so this ends every other session at once.
        </p>
        <SessionActions />
      </section>
    </>
  );
}
