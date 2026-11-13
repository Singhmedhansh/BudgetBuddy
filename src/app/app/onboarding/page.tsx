import type { Metadata } from "next";
import { completeOnboarding, skipAccountStep } from "@/app/app/actions";
import { AccountForm, ProfileStepForm } from "@/components/app/forms";
import { SubmitButton } from "@/components/auth/fields";
import { getContext } from "@/server/context";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Set up Budget Buddy" };

/**
 * Setup is resumable: the step is derived from what already exists, so leaving
 * and coming back continues where the user stopped, and nothing is forced.
 */
export default async function OnboardingPage() {
  const { supabase, profile, space } = await getContext();
  if (profile.onboarding_completed_at) redirect("/app");

  let step: 1 | 2 | 3 = 1;
  if (space) {
    const { count } = await supabase.from("accounts").select("id", { count: "exact", head: true }).eq("space_id", space.id);
    step = (count ?? 0) > 0 || profile.onboarding_state.accountSkipped ? 3 : 2;
  }

  return (
    <div className="mx-auto max-w-lg">
      <p className="text-sm text-muted" aria-live="polite">
        Step {step} of 3
      </p>
      {step === 1 ? (
        <>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Welcome to Budget Buddy</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">Two quick questions so we can set up useful categories. It takes under a minute.</p>
          <div className="mt-8">
            <ProfileStepForm defaults={{ currency: profile.currency, timezone: profile.timezone }} />
          </div>
        </>
      ) : null}
      {step === 2 && space ? (
        <>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Add your first account</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">Where does your money live? Start with one. You can add the rest later.</p>
          <div className="mt-8">
            <AccountForm mode="onboarding" currency={space.currency} />
          </div>
          <form action={skipAccountStep} className="mt-4">
            <button type="submit" className="text-sm text-muted underline hover:text-fg">
              Skip for now
            </button>
          </form>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">You are set up</h1>
          <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">
            Next, record a transaction or create a budget from your dashboard. Everything you skipped is available from the menu whenever you are ready.
          </p>
          <form action={completeOnboarding} className="mt-8">
            <SubmitButton pendingLabel="Opening dashboard">Go to my dashboard</SubmitButton>
          </form>
        </>
      ) : null}
    </div>
  );
}
