/**
 * Budget Buddy mark: a "B" drawn as a ledger stem with two ruled bowls inside a
 * rounded square. Original artwork. The symbol takes its colours from theme
 * tokens so one component serves light and dark.
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
      <path
        d="M11.5 8v16M11.5 8h5.5a3.6 3.6 0 0 1 0 7.2h-5.5m0 0h6.3a4.4 4.4 0 0 1 0 8.8h-6.3"
        fill="none"
        stroke="var(--primary-fg)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="text-[1.05rem] font-semibold tracking-tight text-fg">Budget Buddy</span>
    </span>
  );
}
