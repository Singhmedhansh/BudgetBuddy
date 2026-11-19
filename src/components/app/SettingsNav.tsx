"use client";

import { Bell, CircleUserRound, CreditCard, Link2, ShieldCheck, SlidersHorizontal, Database } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const SETTINGS_LINKS = [
  { href: "/app/settings", label: "Profile", Icon: CircleUserRound, exact: true },
  { href: "/app/settings/preferences", label: "Preferences", Icon: SlidersHorizontal },
  { href: "/app/settings/security", label: "Security", Icon: ShieldCheck },
  { href: "/app/settings/notifications", label: "Notifications", Icon: Bell },
  { href: "/app/settings/billing", label: "Plan and billing", Icon: CreditCard },
  { href: "/app/settings/connected", label: "Connected accounts", Icon: Link2 },
  { href: "/app/settings/privacy", label: "Data and privacy", Icon: Database },
] as const;

/** Vertical list beside the content on wide screens, a scrolling row of tabs on phones. */
export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="-mx-5 mb-8 overflow-x-auto px-5 md:sticky md:top-20 md:mx-0 md:mb-0 md:self-start md:overflow-visible md:px-0">
      <ul className="flex gap-1 md:flex-col">
        {SETTINGS_LINKS.map(({ href, label, Icon, ...rest }) => {
          const on = "exact" in rest && rest.exact ? path === href : path.startsWith(href);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${on ? "bg-sage font-medium text-fg" : "text-muted hover:bg-sunken hover:text-fg"}`}
              >
                <Icon size={16} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
