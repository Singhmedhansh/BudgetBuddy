import type { Metadata } from "next";
import { privatePageMetadata } from "@/config/seo";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/AuthShell";
import { LoginForm, MagicLinkForm, SocialButtons } from "@/components/auth/forms";
import { isOAuthReason, oauthMessage } from "@/lib/auth/oauth-errors";
import { getEnabledProviders } from "@/lib/auth/providers";
import { safeNext } from "@/lib/auth/safe-redirect";

export const metadata: Metadata = privatePageMetadata("Log in");

export default function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <AuthShell
      title="Log in"
      footer={
        <>
          New to FinTrack?{" "}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function LoginContent({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next, "");
  const lastProvider = (await cookies()).get("bb-last-provider")?.value;
  const { social } = await getEnabledProviders();
  const failure = isOAuthReason(sp.error) ? oauthMessage(sp.error, sp.provider) : sp.error === "oauth" ? oauthMessage("failed", "google") : "";
  const notice =
    sp.reset === "1"
      ? "Your password was updated. Log in with the new one."
      : sp.deleted === "1"
        ? "Your account and its data have been deleted."
        : sp.deleted === "data"
          ? "Your FinTrack data has been deleted. Your sign-in identity is kept until support removes it, because it is shared with other products."
          : undefined;
  return (
    <div className="space-y-5">
      {failure ? (
        <p role="alert" className="rounded-md border border-neg/50 bg-neg/10 px-3 py-2.5 text-sm text-neg-text">
          {failure}
        </p>
      ) : null}
      {social.length > 0 ? (
        <>
          <SocialButtons providers={social} next={next || undefined} lastUsed={lastProvider} />
          <p className="text-center text-xs text-muted">or use your email</p>
        </>
      ) : null}
      <LoginForm next={next || undefined} notice={notice} />
      <MagicLinkForm next={next || undefined} />
    </div>
  );
}
