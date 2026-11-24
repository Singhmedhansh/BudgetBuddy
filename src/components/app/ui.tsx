import { Inbox, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { BackButton } from "@/components/nav/BackButton";
import { formatMoney } from "@/domain/money";
import { formatInstant, getFormatPrefs } from "@/lib/format-prefs";

export function PageHeader({ title, description, action, help, back }: { title: string; description?: string; action?: { href: string; label: string }; help?: { slug: string; label: string }; back?: { href: string; label?: string } }) {
  return (
    <div className="mb-8">
      {back ? <BackButton fallbackHref={back.href} label={back.label} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl leading-tight sm:text-[2.1rem]">{title}</h1>
          {description ? <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted">{description}</p> : null}
          {help ? (
            <Link href={`/help/${help.slug}`} className="mt-2 inline-block text-sm text-primary underline-offset-2 hover:underline">
              Help: {help.label}
            </Link>
          ) : null}
        </div>
        {action ? (
          <Link href={action.href} className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-fg shadow-sm transition-all hover:-translate-y-px hover:bg-primary-hover hover:shadow-card">
            {action.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** An empty list or page. The icon names what belongs here; the default is a plain empty tray (never an AI sparkle). */
export function EmptyState({ title, body, action, Icon = Inbox }: { title: string; body: string; action?: { href: string; label: string }; Icon?: LucideIcon }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center">
      <span aria-hidden className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-sage text-primary">
        <Icon size={19} />
      </span>
      <h2 className="font-display text-xl">{title}</h2>
      <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-muted">{body}</p>
      {action ? (
        <Link href={action.href} className="mt-6 inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "success" | "error"; children: React.ReactNode }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`mb-6 rounded-md border px-3 py-2.5 text-sm ${kind === "error" ? "border-neg/50 bg-neg/10 text-neg-text" : "border-pos/50 bg-pos/10 text-pos-text"}`}>
      {children}
    </p>
  );
}

export function Money({ minor, currency, signed, className = "" }: { minor: number; currency: string; signed?: boolean; className?: string }) {
  const text = formatMoney(Math.abs(minor), currency, getFormatPrefs().numberLocale);
  const sign = minor < 0 ? "-" : signed && minor > 0 ? "+" : "";
  return <span className={`num ${className}`}>{sign}{text}</span>;
}

export function formatDate(iso: string, timeZone: string) {
  return formatInstant(new Date(iso), timeZone);
}

/** Formats a calendar date ("2026-11-13") without any timezone shift. */
export function formatDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return formatInstant(new Date(Date.UTC(y, m - 1, d)), "UTC");
}
