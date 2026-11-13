"use client";

import { Bell, CircleUserRound, HelpCircle, LogOut, Settings, ShieldCheck, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/app/(auth)/actions";

export interface AccountMenuProps {
  name: string;
  email: string;
  avatarUrl: string | null;
  /** Required-field completion, so the menu can show Pending until the profile is done. */
  profile: { percent: number; status: "pending" | "complete" };
  /** Rendered above the links on small screens, where the sidebar space switcher is hidden. */
  children?: React.ReactNode;
}

const ITEMS = [
  { href: "/app/settings", label: "My profile", Icon: CircleUserRound },
  { href: "/app/settings/connected", label: "Account settings", Icon: Settings },
  { href: "/app/settings/preferences", label: "Preferences", Icon: SlidersHorizontal },
  { href: "/app/settings/security", label: "Security", Icon: ShieldCheck },
  { href: "/app/settings/notifications", label: "Notifications", Icon: Bell },
  { href: "/help", label: "Help Centre", Icon: HelpCircle },
] as const;

export function Avatar({ name, url, size = 28 }: { name: string; url: string | null; size?: number }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL to a private bucket
    <img src={url} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="grid place-items-center rounded-full bg-primary font-semibold text-primary-fg" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initial}
    </span>
  );
}

/** Profile button and dropdown: keyboard navigable, closes on Escape, outside click and navigation. */
export function AccountMenu({ name, email, avatarUrl, profile, children }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    // Move focus into the menu when it opens so the arrow keys work straight away.
    root.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open, close]);

  function onMenuKey(e: React.KeyboardEvent) {
    const items = [...(root.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close();
  }

  const pending = profile.status === "pending";
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-9 items-center gap-2 rounded-full border border-line-strong bg-surface py-1 pl-1 pr-3 text-sm transition-colors hover:border-primary"
      >
        <span className="relative">
          <Avatar name={name} url={avatarUrl} />
          {pending ? <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-warn" /> : null}
        </span>
        <span className="hidden max-w-[9rem] truncate sm:block">{name}</span>
      </button>

      {open ? (
        <div id={menuId} role="menu" aria-label="Account" onKeyDown={onMenuKey} className="anim-pop glass absolute right-0 z-40 mt-2 w-72 rounded-xl p-2 shadow-float">
          <div className="flex items-center gap-3 px-2 pb-2 pt-1.5">
            <Avatar name={name} url={avatarUrl} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted">{email}</p>
            </div>
          </div>
          {children}
          <div className="my-1 border-t border-line" />
          {ITEMS.map(({ href, label, Icon }) => (
            <Link key={href} href={href} role="menuitem" tabIndex={-1} onClick={() => close()} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm outline-none transition-colors hover:bg-sage focus-visible:bg-sage">
              <Icon size={16} aria-hidden className="text-muted" />
              <span className="flex-1">{label}</span>
              {label === "My profile" && pending ? <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn-text">Pending · {profile.percent}%</span> : null}
            </Link>
          ))}
          <div className="my-1 border-t border-line" />
          <form action={signOut}>
            <button type="submit" role="menuitem" tabIndex={-1} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-sage focus-visible:bg-sage">
              <LogOut size={16} aria-hidden className="text-muted" />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
