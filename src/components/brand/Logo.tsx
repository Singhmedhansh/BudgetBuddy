/**
 * FinTrack mark: a stem that carries two lines out to connected points, the
 * second sitting higher and lighter than the first. It reads as an "F", as a
 * trace of money moving from one place to another, and as information held in
 * one frame. Original geometry on a rounded square.
 *
 * Colours come from theme tokens, so one component serves light and dark. The
 * static files in /public/brand and the app icons use the same geometry.
 */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M11 24.5V9.5h8.5M11 16.2h5.5" fill="none" stroke="var(--primary-fg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23" cy="9.5" r="2.6" fill="var(--sage)" />
      <circle cx="20" cy="16.2" r="1.9" fill="var(--primary-fg)" />
    </svg>
  );
}

/** Wordmark in Fraunces: "Fin" light, "Track" heavier, so the two halves of the name read as one word. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-[1.25rem] leading-none tracking-[-0.02em] text-fg ${className}`} aria-label="FinTrack">
      <span aria-hidden className="font-light">
        Fin
      </span>
      <span aria-hidden className="font-semibold">
        Track
      </span>
    </span>
  );
}

/** Full lock-up. `compact` shows the symbol alone (used on narrow screens and where space is tight). */
export function Logo({ size = 28, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      {compact ? <span className="sr-only">FinTrack</span> : <Wordmark />}
    </span>
  );
}
