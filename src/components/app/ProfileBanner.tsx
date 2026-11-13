import Link from "next/link";
import { dismissProfileBannerAction } from "@/app/app/settings-actions";
import { profileCompletion, showProfileBanner, type ProfileFields } from "@/domain/profile";

/**
 * Reminder to finish the profile, shown while required details are missing. "Not now" only hides it for a few days
 * and never marks anything complete: the status in Settings and the account menu stays Pending until it is true.
 */
export function ProfileBanner({ profile }: { profile: ProfileFields }) {
  // Evaluated per request on the server; this component only renders inside the signed-in shell.
  if (!showProfileBanner(profile, new Date())) return null;
  const c = profileCompletion(profile);
  return (
    <section aria-label="Complete your profile" className="glass mb-6 overflow-hidden rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 max-w-xl">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-xl font-semibold">Complete your profile</h2>
            <span className="rounded-full bg-warn/15 px-2.5 py-0.5 text-xs font-medium text-warn-text">Pending</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">You are almost there. Add a few details to personalise your FinTrack experience.</p>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-2 w-40 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Profile completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.percent}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${c.percent}%` }} />
            </div>
            <span className="num text-sm font-medium">{c.percent}%</span>
          </div>
          <p className="mt-3 text-sm text-muted">Still to add: {c.missing.map((m) => m.label.toLowerCase()).join(", ")}.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/app/settings" className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-fg transition-all hover:-translate-y-px hover:bg-primary-hover hover:shadow-card">
            Complete profile
          </Link>
          <form action={dismissProfileBannerAction}>
            <button type="submit" className="rounded-full px-3 py-2 text-sm text-muted transition-colors hover:text-fg">
              Not now
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
