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
          {g.title !== "Overview" ? <p className="mb-1.5 px-3 text-[11px] font-medium text-white/40">{g.title}</p> : null}
          <ul className="flex flex-col gap-0.5">
            {g.items.map(({ href, label, Icon, exact }) => {
              const on = active(href, exact);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={on ? "page" : undefined}
                    className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${on ? "bg-white/10 font-semibold text-white ring-1 ring-white/15" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
                  >
                    {on ? <span aria-hidden className="absolute -left-1 top-2 bottom-2 w-0.5 rounded bg-mint" /> : null}
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
    <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 items-end border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden">
      {left.map((i) => (
        <BottomItem key={i.href} href={i.href} label={i.label} Icon={i.Icon} on={active(i.href, i.exact)} />
      ))}
      <Link href="/app/transactions/new" aria-label="Add transaction" className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-fg shadow-float transition-transform active:scale-95">
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
