import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/Logo";
import { BottomNav, SidebarNav } from "@/components/app/AppNav";
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
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-line bg-surface md:flex md:flex-col md:p-4">
        <Link href="/app" aria-label="Budget Buddy dashboard" className="px-2 py-2">
          <Logo />
        </Link>
        <div className="mt-6 flex-1">
          <SidebarNav />
        </div>
        <Link href="/app/transactions/new" className="mb-4 rounded-md bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-fg hover:bg-primary-hover">
          Add transaction
        </Link>
      </aside>
      <div className="flex min-w-0 flex-col pb-20 md:pb-0">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-line bg-bg px-5">
          <Link href="/app" className="md:hidden" aria-label="Budget Buddy dashboard">
            <Logo size={24} />
          </Link>
          <p className="hidden truncate text-sm text-muted md:block">{space?.name ?? "Set up your finances"}</p>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <details className="relative">
              <summary className="flex h-8 max-w-[6.5rem] cursor-pointer sm:max-w-[10rem] list-none items-center rounded-md border border-line bg-surface px-3 text-sm">
                <span className="truncate">{name}</span>
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-56 rounded-md border border-line-strong bg-surface p-2 shadow-sm">
                <p className="truncate px-2 py-1.5 text-xs text-muted">{user.email}</p>
                <form action={signOut}>
                  <button type="submit" className="w-full rounded px-2 py-2 text-left text-sm hover:bg-sunken">
                    Log out
                  </button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]" aria-busy="true">
      <div className="hidden border-r border-line bg-surface md:block" />
      <div className="space-y-4 p-8">
        <div className="h-8 w-48 animate-pulse rounded bg-line" />
        <div className="h-40 animate-pulse rounded bg-line" />
      </div>
    </div>
  );
}
