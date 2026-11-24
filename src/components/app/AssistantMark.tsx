/** Finn's mark: a lens in the brand greens, a nod to "your finances, in focus", with a small spark for the assistant. */
export function AssistantMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 40 40" fill="none" className={className}>
      <rect width="40" height="40" rx="12" fill="#0b4a35" />
      <circle cx="19" cy="20" r="9.5" stroke="#f6f5e6" strokeWidth="2.4" />
      <circle cx="19" cy="20" r="4.2" fill="#3f8a63" />
      <circle cx="19" cy="20" r="1.7" fill="#f6f5e6" />
      <path d="M30.5 7.5l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1z" fill="#c5dbb8" />
    </svg>
  );
}
