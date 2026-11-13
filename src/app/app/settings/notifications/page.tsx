import type { Metadata } from "next";
import { NotificationsForm } from "@/components/app/settings-forms";
import { normalizeNotificationPrefs } from "@/domain/profile";
import { getContext } from "@/server/context";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { profile } = await getContext();
  return (
    <section aria-labelledby="notes">
      <h2 id="notes" className="mb-1 font-semibold">
        What you want to hear about
      </h2>
      <p className="mb-5 text-sm leading-relaxed text-muted">FinTrack does not send email or push notifications yet. Your choices are saved now and will apply the moment delivery is switched on, so you will not have to set them again.</p>
      <NotificationsForm initial={normalizeNotificationPrefs(profile.notification_prefs)} />
    </section>
  );
}
