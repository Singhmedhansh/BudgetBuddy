import Link from "next/link";
import { formatMoney } from "@/domain/money";

export function PageHeader({ title, description, action, help }: { title: string; description?: string; action?: { href: string; label: string }; help?: { slug: string; label: string } }) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted">{description}</p> : null}
        {help ? (
          <Link href={`/help/${help.slug}`} className="mt-2 inline-block text-sm text-primary underline-offset-2 hover:underline">
            Help: {help.label}
          </Link>
        ) : null}
      </div>
      {action ? (
        <Link href={action.href} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:bg-primary-hover">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <div className="rounded-md border border-dashed border-line-strong px-6 py-12 text-center">
      <h2 className="font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-muted">{body}</p>
      {action ? (
        <Link href={action.href} className="mt-5 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:bg-primary-hover">
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
  const text = formatMoney(Math.abs(minor), currency);
  const sign = minor < 0 ? "-" : signed && minor > 0 ? "+" : "";
  return <span className={`num ${className}`}>{sign}{text}</span>;
}

export function formatDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
