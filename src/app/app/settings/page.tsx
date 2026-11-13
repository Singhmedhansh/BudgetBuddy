import type { Metadata } from "next";
import Link from "next/link";
import { DeleteDataForm, ProfileForm } from "@/components/app/settings-forms";
import { PageHeader } from "@/components/app/ui";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { getContext } from "@/server/context";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { profile, user, space, role } = await getContext();
  return (
    <>
      <PageHeader title="Settings" description="Your profile, appearance and data." />
      <div className="max-w-xl space-y-14">
        <section aria-labelledby="profile">
          <h2 id="profile" className="mb-4 font-semibold">
            Profile
          </h2>
          <p className="mb-4 text-sm text-muted">Signed in as {user.email}. {space ? `Money in ${space.name} is recorded in ${space.currency}; a space's currency is fixed when it is created.` : null}</p>
          <ProfileForm name={profile.display_name ?? ""} timezone={profile.timezone} />
        </section>

        <section aria-labelledby="appearance">
          <h2 id="appearance" className="mb-4 font-semibold">
            Appearance
          </h2>
          <ThemeToggle />
        </section>

        <section aria-labelledby="plan">
          <h2 id="plan" className="mb-2 font-semibold">
            Plan
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            You are on the Free plan. Paid plans and checkout are not available yet, so nothing here can charge you. See <Link href="/#pricing" className="text-primary hover:underline">what is planned</Link>.
          </p>
        </section>

        <section aria-labelledby="data">
          <h2 id="data" className="mb-2 font-semibold">
            Your data
          </h2>
          <p className="text-sm leading-relaxed text-muted">Download everything you have recorded at any time, on any plan.</p>
          <p className="mt-3 flex flex-wrap gap-4 text-sm">
            <a href="/app/export/all" className="text-primary hover:underline">Download all data (JSON)</a>
            <a href="/app/export/transactions" className="text-primary hover:underline">Download transactions (CSV)</a>
          </p>
          <div className="mt-8 rounded-xl border border-neg/40 p-5">
            <h3 className="font-medium text-neg-text">Delete my Budget Buddy data</h3>
            <p className="mb-4 mt-1 text-sm leading-relaxed text-muted">
              This permanently deletes your profile and every space you own on your own, including all accounts, transactions, budgets and goals. Spaces you only belong to are left, and you are removed from them. It cannot be undone, so download your data first.
              {role === "owner" ? " If other people use a space you own, remove them first." : ""}
            </p>
            <DeleteDataForm />
          </div>
        </section>
      </div>
    </>
  );
}
