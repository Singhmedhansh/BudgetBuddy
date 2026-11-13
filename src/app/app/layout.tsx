import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/Logo";
import { BottomNav, SidebarNav } from "@/components/app/AppNav";
import { BackToTop } from "@/components/motion/BackToTop";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { getContext } from "@/server/context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  const { user, profile, space } = await getContext();
  const name = profile.display_name || user.email || "Account";
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15.5rem_minmax(0,1fr)]">
      {/* Sidebar: deep ink in both themes, so navigation reads as a fixed frame around the work */}
      <aside className="hidden bg-ink text-white md:sticky md:top-0 md:flex md:h-screen md:flex-col md:p-4">
        <Link href="/app" aria-label="Budget Buddy dashboard" className="rounded-md px-2 py-2 [&_span]:!text-white">
          <Logo />
        </Link>
        <div className="mt-4 rounded-lg bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
          <p className="text-[11px] text-white/50">Finances</p>
          <p className="truncate text-sm font-medium">{space?.name ?? "Set up your finances"}</p>
        </div>
        <div className="-mx-1 mt-5 flex-1 overflow-y-auto px-1">
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
          <Link href="/app" className="md:hidden" aria-label="Budget Buddy dashboard">
            <Logo size={24} />
          </Link>
          <p className="hidden truncate text-sm text-muted md:block">{space?.name ?? "Set up your finances"}</p>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <details className="group relative">
              <summary aria-label="Account menu" className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-full border border-line-strong bg-surface py-1 pl-1 pr-3 text-sm transition-colors hover:border-primary">
                <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-fg">
                  {initial}
                </span>
                <span className="hidden max-w-[9rem] truncate sm:block">{name}</span>
              </summary>
              <div className="anim-pop glass absolute right-0 z-40 mt-2 w-60 rounded-xl p-2 shadow-float">
                <p className="truncate px-2 py-1.5 text-xs text-muted">{user.email}</p>
                <Link href="/help" className="block rounded-lg px-2 py-2 text-sm hover:bg-sage md:hidden">
                  Help Centre
                </Link>
                <Link href="/contact" className="block rounded-lg px-2 py-2 text-sm hover:bg-sage">
                  Contact support
                </Link>
                <form action={signOut}>
                  <button type="submit" className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-sage">
                    Log out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 md:px-8 md:py-10">
          {children}
        </main>
      </div>
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
