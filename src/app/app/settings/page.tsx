import type { Metadata } from "next";
import { AvatarUploader, EmailChangeForm, ProfileForm } from "@/components/app/settings-forms";
import { profileCompletion } from "@/domain/profile";
import { avatarUrl, hasPassword } from "@/server/account";
import { getContext } from "@/server/context";

export const metadata: Metadata = { title: "Profile settings" };

export default async function ProfilePage() {
  const { supabase, user, profile } = await getContext();
  const c = profileCompletion(profile);
  const photo = await avatarUrl(supabase, profile);
  const name = profile.display_name ?? "";
  return (
    <>
      <section aria-labelledby="completion" className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="completion" className="font-semibold">
            Profile completion
          </h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${c.status === "complete" ? "bg-pos/15 text-pos-text" : "bg-warn/15 text-warn-text"}`}>{c.status === "complete" ? "Complete" : "Pending"}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Profile completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.percent}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${c.percent}%` }} />
        </div>
        <p className="mt-3 text-sm text-muted">
          {c.status === "complete" ? "Everything needed is filled in. Thank you." : `${c.percent}% done. Still to add: ${c.missing.map((m) => m.label.toLowerCase()).join(", ")}.`}
        </p>
        {c.optionalMissing.length > 0 ? <p className="mt-1 text-sm text-muted">Optional: {c.optionalMissing.map((m) => m.label.toLowerCase()).join(", ")}.</p> : null}
      </section>

      <section aria-labelledby="photo">
        <h2 id="photo" className="mb-4 font-semibold">
          Photo
        </h2>
        <AvatarUploader userId={user.id} name={name || user.email || "Account"} url={photo} />
      </section>

      <section aria-labelledby="details">
        <h2 id="details" className="mb-4 font-semibold">
          Personal details
        </h2>
        <ProfileForm
          initial={{
            name,
            country: profile.country ?? "",
            persona: profile.persona ?? "",
            currency: profile.currency,
            timezone: profile.timezone,
            dateFormat: profile.date_format ?? "",
            phone: profile.phone ?? "",
          }}
        />
      </section>

      <section aria-labelledby="email">
        <h2 id="email" className="mb-4 font-semibold">
          Email
        </h2>
        <EmailChangeForm email={user.email ?? ""} pendingEmail={user.new_email ?? null} verified={Boolean(user.email_confirmed_at)} needsPassword={hasPassword(user)} />
      </section>
    </>
  );
}
