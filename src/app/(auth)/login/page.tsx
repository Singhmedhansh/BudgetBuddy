import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/AuthShell";
import { GoogleButton, LoginForm } from "@/components/auth/forms";
import { safeNext } from "@/lib/auth/safe-redirect";
import { googleAuthEnabled } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <AuthShell
      title="Log in"
      footer={
        <>
          New to Budget Buddy?{" "}
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
  const google = googleAuthEnabled();
  const notice =
    sp.error === "oauth"
      ? undefined
      : sp.reset === "1"
        ? "Your password was updated. Log in with the new one."
        : undefined;
  return (
    <div className="space-y-5">
      {sp.error === "oauth" ? (
        <p role="alert" className="rounded-md border border-neg/50 bg-neg/10 px-3 py-2.5 text-sm text-neg-text">
          Google sign-in did not complete. Try again, or log in with your email and password.
        </p>
      ) : null}
      {google ? (
        <>
          {lastProvider === "google" ? (
            <p className="text-sm text-muted">You signed in with Google last time on this device.</p>
          ) : null}
          <GoogleButton next={next || undefined} />
          <p className="text-center text-xs text-muted">or use your email</p>
        </>
      ) : null}
      <LoginForm next={next || undefined} notice={notice} />
    </div>
  );
}
