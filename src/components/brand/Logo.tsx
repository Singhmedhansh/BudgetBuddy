/**
 * FinTrack logo, from the approved artwork (public/brand/fintrack-logo-source.png):
 * a folded "F" with a three-point trend line on a deep green tile, and a Fraunces
 * wordmark, "Fin" in brand green and "Track" in the text colour. The tile is the
 * same in light and dark; the wordmark follows the theme tokens.
 */
import { MARK } from "./mark-geometry";

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
      <rect width="32" height="32" rx="8.5" fill={MARK.tile} stroke="rgba(255,255,255,0.16)" strokeWidth="0.5" />
      <path d={MARK.panelPath} fill={MARK.panel} />
      <path d={MARK.stemPath} fill={MARK.stem} />
      <path d={MARK.barPath} fill={MARK.bar} />
      <path d={MARK.linePath} fill="none" stroke={MARK.bar} strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
      {MARK.nodes.map(([cx, cy, r]) => (
        <circle key={cx} cx={cx} cy={cy} r={r} fill={MARK.bar} />
      ))}
    </svg>
  );
}

/** Wordmark in Fraunces: "Fin" medium in brand green, "Track" extra bold in the text colour. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-[1.25rem] leading-none tracking-[-0.02em] text-fg ${className}`} aria-label="FinTrack">
      <span aria-hidden className="font-medium text-primary">
        Fin
      </span>
      <span aria-hidden className="font-extrabold">
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
