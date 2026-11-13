import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/AuthShell";
import { ResetPasswordForm } from "@/components/auth/forms";
import { isRecoveryTokenValidNow, RECOVERY_COOKIE } from "@/lib/auth/recovery-guard";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" description="Pick something you do not use anywhere else. Other devices will be signed out.">
      <Suspense fallback={<FormSkeleton />}>
        <Gate />
      </Suspense>
    </AuthShell>
  );
}

/** The form is only offered to someone who arrived through a valid reset link. Everyone else is told how to get one. */
async function Gate() {
  const supabase = await createClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const token = (await cookies()).get(RECOVERY_COOKIE)?.value;
  let allowed = false;
  try {
    allowed = Boolean(data.user) && isRecoveryTokenValidNow(token, data.user!.id);
  } catch {
    allowed = false; // missing server secret: fail closed
  }
  if (!allowed) {
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p>This reset link has expired, was already used, or is not valid.</p>
        <p>
          <Link href="/forgot-password" className="font-medium text-primary hover:underline">
            Request a new reset link
          </Link>
        </p>
      </div>
    );
  }
  return <ResetPasswordForm />;
}
