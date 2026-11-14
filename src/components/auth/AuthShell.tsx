import { FileUp, ReceiptText, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { LogoMark, Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { BRAND } from "@/config/brand";

/** What the side panel says. Every line restates something the product really does and the landing page already claims. */
const POINTS = [
  { Icon: ReceiptText, title: "A ledger that balances", body: "Every entry nets to zero, and moving money between your own accounts is never counted as spending." },
  { Icon: ShieldCheck, title: "Private by design", body: "Database rules decide who can read each record. Export everything you have recorded whenever you like." },
  { Icon: FileUp, title: "Imports you can check", body: "Review every row of a statement before anything is saved. Importing the same file twice adds nothing." },
] as const;

/**
 * Two columns on a wide screen: the form in a card on the left, a short statement of what FinTrack is on the right.
 * On a phone only the card is shown, so the form is never pushed down the page.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-w-0 flex-col">
        <header className="flex h-16 items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="FinTrack home">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>

        <main id="main" className="flex flex-1 items-center justify-center px-5 pb-10 pt-4 sm:px-8">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-line bg-surface p-6 shadow-md sm:p-8">
              <h1 className="font-display text-3xl leading-tight tracking-tight">{title}</h1>
              {description ? <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p> : null}
              <div className="mt-7">{children}</div>
              {footer ? <div className="mt-7 border-t border-line pt-5 text-center text-sm text-muted">{footer}</div> : null}
            </div>
            <nav aria-label="Legal" className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted">
              <Link href="/legal/terms" className="hover:text-fg">
                Terms
              </Link>
              <Link href="/legal/privacy" className="hover:text-fg">
                Privacy
              </Link>
              <Link href="/security" className="hover:text-fg">
                Security
              </Link>
              <Link href="/help" className="hover:text-fg">
                Help
              </Link>
            </nav>
          </div>
        </main>
      </div>

      <aside aria-label={`About ${BRAND.name}`} className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-14">
        {/* A soft mint glow and a faint dot grid: depth without imagery that says anything untrue. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(60% 50% at 85% 10%, rgba(155,227,191,0.22), transparent 70%), radial-gradient(50% 40% at 0% 100%, rgba(155,227,191,0.12), transparent 70%)" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "26px 26px" }} />

        <div className="relative flex items-center gap-3">
          <LogoMark size={36} />
          <span className="text-lg font-semibold tracking-tight">{BRAND.name}</span>
        </div>

        <div className="relative max-w-lg">
          <p className="font-display text-5xl leading-[1.05] tracking-tight">{BRAND.tagline}</p>
          <p className="mt-5 max-w-[44ch] text-base leading-relaxed text-white/70">Track spending, plan budgets, keep bills and goals in one place, and trust that the totals match what actually happened.</p>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ Icon, title: t, body }) => (
              <li key={t} className="flex gap-4">
                <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-mint ring-1 ring-white/15">
                  <Icon size={20} aria-hidden />
                </span>
                <div>
                  <p className="font-semibold">{t}</p>
                  <p className="mt-1 max-w-[46ch] text-sm leading-relaxed text-white/65">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/50">Balances are calculated from what you record. FinTrack is not a bank and does not move money.</p>
      </aside>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-line" />
      ))}
    </div>
  );
}
