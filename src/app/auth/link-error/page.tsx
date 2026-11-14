import type { Metadata } from "next";
import { privatePageMetadata } from "@/config/seo";
import Link from "next/link";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata: Metadata = privatePageMetadata("Link expired");

export default function LinkErrorPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  return (
    <Suspense>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const reset = (await searchParams).kind === "reset";
  return (
    <AuthShell
      title="This link has expired or is not valid"
      description={
        reset
          ? "Password reset links work once and expire after an hour. Request a new one to continue."
          : "Confirmation links work once and expire after a while. Log in to get a new confirmation link."
      }
    >
      <Link
        href={reset ? "/forgot-password" : "/login"}
        className="inline-block rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover"
      >
        {reset ? "Request a new reset link" : "Go to log in"}
      </Link>
    </AuthShell>
  );
}
