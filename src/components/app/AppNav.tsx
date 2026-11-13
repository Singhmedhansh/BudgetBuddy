"use client";

import { ArrowLeftRight, Landmark, LayoutDashboard, PiggyBank, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/app", label: "Dashboard", Icon: LayoutDashboard, exact: true },
  { href: "/app/transactions", label: "Transactions", Icon: ArrowLeftRight },
  { href: "/app/accounts", label: "Accounts", Icon: Landmark },
  { href: "/app/budgets", label: "Budgets", Icon: PiggyBank },
];

function useActive() {
  const path = usePathname();
  return (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(href + "/"));
}

export function SidebarNav() {
  const active = useActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {ITEMS.map(({ href, label, Icon, exact }) => {
        const on = active(href, exact);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
              on ? "bg-sage font-semibold text-fg" : "text-muted hover:bg-sunken hover:text-fg"
            }`}
          >
            <Icon size={17} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const active = useActive();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 items-end border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      {ITEMS.slice(0, 2).map(({ href, label, Icon, exact }) => (
        <BottomItem key={href} href={href} label={label} Icon={Icon} on={active(href, exact)} />
      ))}
      <Link
        href="/app/transactions/new"
        aria-label="Add transaction"
        className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-fg shadow-sm"
      >
        <Plus size={22} aria-hidden />
      </Link>
      {ITEMS.slice(2).map(({ href, label, Icon, exact }) => (
        <BottomItem key={href} href={href} label={label} Icon={Icon} on={active(href, exact)} />
      ))}
    </nav>
  );
}

function BottomItem({ href, label, Icon, on }: { href: string; label: string; Icon: typeof Plus; on: boolean }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${on ? "font-semibold text-primary" : "text-muted"}`}>
      <Icon size={19} aria-hidden />
      {label}
    </Link>
  );
}
