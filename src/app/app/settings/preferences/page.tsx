import type { Metadata } from "next";
import { PreferencesForm } from "@/components/app/settings-forms";
import { normalizeDashboardPrefs } from "@/domain/profile";
import { getContext } from "@/server/context";

export const metadata: Metadata = { title: "Preferences" };

export default async function PreferencesPage() {
  const { profile } = await getContext();
  return (
    <section aria-labelledby="prefs">
      <h2 id="prefs" className="sr-only">
        Preferences
      </h2>
      <PreferencesForm
        initial={{
          theme: profile.theme,
          currency: profile.currency,
          timezone: profile.timezone,
          dateFormat: profile.date_format ?? "",
          numberFormat: profile.number_format ?? "en-IN",
          dashboard: normalizeDashboardPrefs(profile.dashboard_prefs),
        }}
      />
    </section>
  );
}
