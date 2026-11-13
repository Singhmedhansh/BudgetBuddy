"use client";

import { Grid2x2, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, type NavItem } from "./nav-items";

function useActive() {
  const path = usePathname();
  return (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(href + "/"));
}

export function SidebarNav() {
  const active = useActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV_GROUPS.map((g) => (
        <div key={g.title}>
          {g.title !== "Overview" ? <p className="mb-1 px-3 text-xs font-medium text-muted">{g.title}</p> : null}
          <ul className="flex flex-col gap-0.5">
            {g.items.map(({ href, label, Icon, exact }) => {
              const on = active(href, exact);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={on ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${on ? "bg-sage font-semibold text-fg" : "text-muted hover:bg-sunken hover:text-fg"}`}
                  >
                    <Icon size={17} aria-hidden />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

const find = (href: string): NavItem => NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href)!;

export function BottomNav() {
  const active = useActive();
  const left = [find("/app"), find("/app/transactions")];
  const right = [find("/app/budgets")];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 items-end border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      {left.map((i) => (
        <BottomItem key={i.href} href={i.href} label={i.label} Icon={i.Icon} on={active(i.href, i.exact)} />
      ))}
      <Link href="/app/transactions/new" aria-label="Add transaction" className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-fg shadow-sm">
        <Plus size={22} aria-hidden />
      </Link>
      {right.map((i) => (
        <BottomItem key={i.href} href={i.href} label={i.label} Icon={i.Icon} on={active(i.href, i.exact)} />
      ))}
      <BottomItem href="/app/more" label="More" Icon={Grid2x2} on={active("/app/more")} />
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
