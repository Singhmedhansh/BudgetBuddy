import type { Metadata } from "next";
import { privatePageMetadata } from "@/config/seo";
import Link from "next/link";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/AuthShell";
import { SignupForm, SocialButtons } from "@/components/auth/forms";
import { getEnabledProviders } from "@/lib/auth/providers";

export const metadata: Metadata = privatePageMetadata("Create your account");

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Free to start. You can add accounts, budgets and goals after you sign up."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <SignupContent />
      </Suspense>
    </AuthShell>
  );
}

async function SignupContent() {
  const { social } = await getEnabledProviders();
  return (
    <div className="space-y-5">
      {social.length > 0 ? (
        <>
          <SocialButtons providers={social} next="/app/onboarding" verb="Sign up" />
          <p className="text-center text-xs text-muted">or sign up with your email</p>
        </>
      ) : null}
      <SignupForm />
    </div>
  );
}
