import type { Metadata } from "next";
import Link from "next/link";
import { ConnectedAccounts, type ConnectedIdentity } from "@/components/app/settings-forms";
import { planName } from "@/config/plans";
import { canUnlink } from "@/domain/profile";
import { isOAuthReason, oauthMessage } from "@/lib/auth/oauth-errors";
import { getEnabledProviders } from "@/lib/auth/providers";
import { getContext } from "@/server/context";
import { resolveEntitlement, type EntitlementRow } from "@/server/payments/entitlements";

export const metadata: Metadata = { title: "Connected accounts" };

const LABEL: Record<string, string> = { email: "Email and password", google: "Google", github: "GitHub" };

export default async function ConnectedPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, user } = await getContext();
  const [{ data }, { social }] = await Promise.all([supabase.auth.getUserIdentities(), getEnabledProviders()]);
  // Reads this person's own entitlement row; a missing table or row simply means the Free plan.
  const { data: ent } = await supabase.from("entitlements").select("plan,status,current_period_end").maybeSingle();
  const plan = resolveEntitlement(ent as EntitlementRow | null, new Date());
  const list = data?.identities ?? [];
  const identities: ConnectedIdentity[] = list.map((i) => {
    const check = canUnlink(list, i.provider);
    const email = (i.identity_data as { email?: string } | undefined)?.email ?? null;
    return { provider: i.provider, label: LABEL[i.provider] ?? i.provider, detail: email ?? (i.provider === "email" ? user.email ?? null : null), canUnlink: check.ok, reason: check.reason };
  });
  const error = isOAuthReason(sp.error) ? oauthMessage(sp.error, sp.provider) : undefined;
  return (
    <>
      <section aria-labelledby="signin">
        <h2 id="signin" className="mb-1 font-semibold">
          Ways to sign in
        </h2>
        <p className="mb-5 text-sm leading-relaxed text-muted">Connect more than one so you can always get back in. You cannot disconnect your only sign-in method.</p>
        <ConnectedAccounts identities={identities} linkable={social} error={error} />
      </section>
      <section aria-labelledby="plan">
        <h2 id="plan" className="mb-2 font-semibold">
          Plan
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          You are on {planName(plan.plan === "pro" ? "pro" : "free")}. Paid plans and checkout are not available yet, so nothing here can charge you. See{" "}
          <Link href="/#pricing" className="text-primary hover:underline">
            what is planned
          </Link>
          .
        </p>
      </section>
    </>
  );
}
