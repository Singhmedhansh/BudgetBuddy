import { PageHeader } from "@/components/app/ui";
import { SettingsNav } from "@/components/app/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" description="Your profile, preferences, security and data." />
      <div className="md:grid md:grid-cols-[13.5rem_minmax(0,1fr)] md:gap-12">
        <SettingsNav />
        <div className="min-w-0 max-w-xl space-y-10">{children}</div>
      </div>
    </>
  );
}
