"use client";

import { ChevronDown, Menu as MenuIcon, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/app/AccountMenu";
import { Logo } from "@/components/brand/Logo";
import { HeaderAccountPill, useSignedIn } from "./HeaderAccount";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export interface MenuItem {
  href: string;
  label: string;
  description: string;
}
export interface Menu {
  id: string;
  label: string;
  intro: string;
  items: MenuItem[];
}

/** Sticky glass header: hover/focus/click mega-menus on desktop, an animated sheet on mobile. */
export function HeaderClient({ menus }: { menus: Menu[] }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [section, setSection] = useState<string>("");
  const rootRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const who = useSignedIn();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-spy for the in-page sections the header links to.
  useEffect(() => {
    const ids = ["showcase", "features", "pricing", "faq"];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setSection(e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const close = useCallback(() => {
    clearTimeout(timer.current); // a pending hover-open must not reopen a menu that was just dismissed
    setOpen(null);
    setMobile(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [close]);

  useEffect(() => {
    document.body.style.overflow = mobile ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobile]);

  const hover = (id: string | null) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(id), id ? 60 : 140);
  };

  return (
    <header ref={rootRef} className={`sticky top-0 z-40 transition-all duration-300 ${scrolled || mobile ? "glass shadow-card" : "border-b border-transparent bg-transparent"}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
        <Link href="/" aria-label="FinTrack home" className="shrink-0 rounded-md" onClick={close}>
          <Logo />
        </Link>

        <nav aria-label="Main" className="ml-6 hidden flex-1 items-center gap-1 lg:flex" onMouseLeave={() => hover(null)}>
          {menus.map((m) => {
            const on = open === m.id;
            return (
              <div key={m.id} className="relative" onMouseEnter={() => hover(m.id)}>
                <button
                  type="button"
                  aria-expanded={on}
                  aria-controls={`menu-${m.id}`}
                  onClick={() => setOpen(on ? null : m.id)}
                  className={`flex items-center gap-1 rounded-md px-3 py-2 text-sm transition-colors ${on ? "bg-sunken text-fg" : "text-muted hover:text-fg"}`}
                >
                  {m.label}
                  <ChevronDown size={14} aria-hidden className={`transition-transform duration-200 ${on ? "rotate-180" : ""}`} />
                </button>
                {on ? (
                  <div id={`menu-${m.id}`} className="anim-pop glass absolute left-0 top-full mt-2 w-[22rem] rounded-xl p-2 shadow-float">
                    <p className="px-3 pb-1 pt-2 text-xs text-muted">{m.intro}</p>
                    <ul>
                      {m.items.map((it) => (
                        <li key={it.label}>
                          <Link href={it.href} onClick={close} className="block rounded-lg px-3 py-2.5 transition-colors hover:bg-sage focus-visible:bg-sage">
                            <span className="block text-sm font-medium">{it.label}</span>
                            <span className="block text-xs leading-snug text-muted">{it.description}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })}
          <Link href="/#pricing" aria-current={section === "pricing" ? "location" : undefined} className={`rounded-md px-3 py-2 text-sm transition-colors ${section === "pricing" ? "text-fg" : "text-muted hover:text-fg"}`}>
            Pricing
            {section === "pricing" ? <span aria-hidden className="mx-auto mt-0.5 block h-0.5 w-4 rounded bg-primary" /> : null}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          {who ? (
            <HeaderAccountPill who={who} />
          ) : (
            <>
              <Link href="/login" className="hidden rounded-md px-2 py-2 text-sm font-medium transition-colors hover:text-primary sm:block">
                Sign in
              </Link>
              <Link href="/signup" className="hidden rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg shadow-sm transition-all hover:-translate-y-px hover:bg-primary-hover hover:shadow-card sm:block">
                Get started
              </Link>
            </>
          )}
          <button
            type="button"
            aria-label={mobile ? "Close menu" : "Open menu"}
            aria-expanded={mobile}
            aria-controls="mobile-menu"
            onClick={() => setMobile((v) => !v)}
            className="grid h-11 w-11 place-items-center rounded-md border border-line-strong bg-surface lg:hidden"
          >
            {mobile ? <X size={20} aria-hidden /> : <MenuIcon size={20} aria-hidden />}
          </button>
        </div>
      </div>

      {/* Mobile sheet: grid-rows transition animates open/close without measuring height. */}
      <div id="mobile-menu" className={`grid transition-[grid-template-rows] duration-300 ease-out lg:hidden ${mobile ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} aria-hidden={!mobile} inert={!mobile}>
        <div className="overflow-hidden">
          <nav aria-label="Mobile" className="max-h-[calc(100dvh-4rem)] overflow-y-auto px-5 pb-6 pt-2">
            {menus.map((m) => (
              <details key={m.id} className="group border-b border-line">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-base font-medium">
                  {m.label}
                  <ChevronDown size={18} aria-hidden className="text-muted transition-transform group-open:rotate-180" />
                </summary>
                <ul className="pb-3">
                  {m.items.map((it) => (
                    <li key={it.label}>
                      <Link href={it.href} onClick={close} className="block min-h-11 rounded-md px-2 py-2 text-sm">
                        <span className="block font-medium">{it.label}</span>
                        <span className="block text-xs text-muted">{it.description}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <Link href="/#pricing" onClick={close} className="flex min-h-12 items-center border-b border-line text-base font-medium">
              Pricing
            </Link>
            {who ? (
              <Link href="/app" onClick={close} className="mt-5 flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-fg">
                <Avatar name={who.name} url={null} size={26} />
                Open FinTrack as {who.name}
              </Link>
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Link href="/login" onClick={close} className="grid min-h-12 place-items-center rounded-full border border-line-strong text-sm font-semibold">
                  Sign in
                </Link>
                <Link href="/signup" onClick={close} className="grid min-h-12 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-fg">
                  Get started
                </Link>
              </div>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
