/**
 * Shown inside the app shell while a page's data loads, so a navigation gives feedback at once instead of
 * holding the previous screen. Mirrors the shape of a typical page: heading, summary cards, then a list.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading</span>
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded bg-line" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-line/70" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-line" />
        ))}
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-line/70" />
        ))}
      </div>
    </div>
  );
}
