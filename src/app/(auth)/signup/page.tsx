import type { Metadata } from "next";
import { privatePageMetadata } from "@/config/seo";
import Link from "next/link";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/AuthShell";
import { AuthDivider, PhoneSignIn, SignupForm, SocialButtons } from "@/components/auth/forms";
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
  const { social, phone } = await getEnabledProviders();
  return (
    <div className="space-y-5">
      {social.length > 0 || phone ? (
        <>
          <div className="space-y-3">
            <SocialButtons providers={social} next="/app/onboarding" verb="Sign up" />
            {phone ? <PhoneSignIn mode="signup" next="/app/onboarding" /> : null}
          </div>
          <AuthDivider>or sign up with your email</AuthDivider>
        </>
      ) : null}
      <SignupForm />
    </div>
  );
}
