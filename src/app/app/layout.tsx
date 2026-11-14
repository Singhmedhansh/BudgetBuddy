import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/Logo";
import { BottomNav, SidebarNav } from "@/components/app/AppNav";
import { SpaceSwitcher } from "@/components/app/SpaceSwitcher";
import { AccountMenu } from "@/components/app/AccountMenu";
import { BackToTop } from "@/components/motion/BackToTop";
import { saveThemeAction } from "@/app/app/settings-actions";
import { ThemeSync } from "@/components/theme/ThemeSync";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { profileCompletion } from "@/domain/profile";
import { setFormatPrefs } from "@/lib/format-prefs";
import { avatarUrl } from "@/server/account";
import { isSampleSpace } from "@/server/sample-data";
import { getContext } from "@/server/context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const { supabase, user, profile, space, spaces, role } = await getContext();
  const name = profile.display_name || user.email || "Account";
  const completion = profileCompletion(profile);
  const avatar = await avatarUrl(supabase, profile);
  // Number and date preferences apply to everything rendered below this point in the request.
  setFormatPrefs({ numberLocale: profile.number_format ?? "en-IN", dateFormat: profile.date_format ?? null });
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15.5rem_minmax(0,1fr)]">
      {/* Sidebar: deep ink in both themes, so navigation reads as a fixed frame around the work */}
      <aside className="hidden bg-ink text-white md:sticky md:top-0 md:flex md:h-screen md:flex-col md:p-4">
        <Link href="/app" aria-label="FinTrack dashboard" className="rounded-md px-2 py-2 [&_span]:!text-white">
          <Logo />
        </Link>
        <div className="mt-4 text-white">
          <SpaceSwitcher spaces={spaces} activeId={space?.id ?? null} role={role} dark />
        </div>
        <div className="scroll-on-ink -mx-1 mt-5 flex-1 overflow-y-auto px-1">
          <SidebarNav />
        </div>
        <Link href="/help" className="mb-2 rounded-md px-3 py-2 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white">
          Help Centre
        </Link>
        <Link href="/app/transactions/new" className="mb-1 flex items-center justify-center gap-2 rounded-full bg-mint px-3 py-2.5 text-center text-sm font-semibold text-ink transition-all hover:-translate-y-px hover:shadow-float">
          <Plus size={16} aria-hidden />
          Add transaction
        </Link>
      </aside>

      <div className="flex min-w-0 flex-col pb-20 md:pb-0">
        <header className="glass sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-x-0 border-t-0 px-5">
          <Link href="/app" className="md:hidden" aria-label="FinTrack dashboard">
            <Logo size={24} />
          </Link>
          <p className="hidden truncate text-sm text-muted md:block">{space?.name ?? "Set up your finances"}{role === "viewer" ? " · view only" : ""}</p>
          {isSampleSpace(space) ? <span className="rounded-full bg-warn/15 px-2.5 py-1 text-xs font-medium text-warn-text">Sample data · fictional</span> : null}
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <ThemeToggle onChoose={saveThemeAction} />
            <AccountMenu name={name} email={user.email ?? ""} avatarUrl={avatar} profile={{ percent: completion.percent, status: completion.status }}>
              <div className="md:hidden">
                <SpaceSwitcher spaces={spaces} activeId={space?.id ?? null} role={role} />
              </div>
            </AccountMenu>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 md:px-8 md:py-10">
          {children}
        </main>
      </div>
      <ThemeSync theme={profile.theme} />
      <BottomNav />
      <BackToTop />
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15.5rem_minmax(0,1fr)]" aria-busy="true">
      <div className="hidden bg-ink md:block" />
      <div className="space-y-4 p-8">
        <div className="h-8 w-48 animate-pulse rounded bg-line" />
        <div className="h-40 animate-pulse rounded-xl bg-line" />
      </div>
    </div>
  );
}
