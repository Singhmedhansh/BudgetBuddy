import type { Metadata } from "next";
import { staticPageMetadata } from "@/config/seo";
import Link from "next/link";
import { Suspense } from "react";
import { PublicPage } from "@/components/landing/PublicPage";
import { ARTICLES, CATEGORIES } from "@/content/help/articles";
import { searchHelp } from "@/content/help/search";

export const metadata: Metadata = staticPageMetadata("help");

export default function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return (
    <PublicPage width="max-w-4xl">
      <h1 className="text-3xl font-semibold tracking-tight">Help Centre</h1>
      <p className="mt-2 max-w-[56ch] text-muted">Search a task in your own words, or browse by topic.</p>
      <Suspense fallback={<div className="mt-6 h-11 max-w-xl animate-pulse rounded-md bg-line" aria-hidden />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </PublicPage>
  );
}

async function Body({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").slice(0, 120);
  const result = q.trim() ? searchHelp(q) : null;
  return (
    <>
      <form role="search" action="/help" className="mt-6 flex max-w-xl gap-2">
        <label htmlFor="help-q" className="sr-only">
          Search help
        </label>
        <input
          id="help-q"
          name="q"
          defaultValue={q}
          placeholder="For example: where can I see grocery spending?"
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3.5 py-2.5 text-sm"
        />
        <button type="submit" className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover">
          Search
        </button>
      </form>

      {result ? <Results q={q} result={result} /> : <Browse />}
    </>
  );
}

function Results({ q, result }: { q: string; result: ReturnType<typeof searchHelp> }) {
  const none = result.articles.length === 0 && result.destinations.length === 0 && !result.direct;
  return (
    <section aria-live="polite" className="mt-10 space-y-10">
      {result.direct ? (
        <div className="rounded-md border border-primary/40 bg-sage/50 p-4">
          <p className="text-sm text-muted">Quickest way there</p>
          <Link href={result.direct.href} className="mt-1 inline-block font-semibold text-primary underline-offset-2 hover:underline">
            {result.direct.label}
          </Link>
          <p className="mt-1 text-xs text-muted">You will need to be signed in. This opens your own transactions filtered by that category.</p>
        </div>
      ) : null}

      {result.articles.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold">Articles for &ldquo;{q}&rdquo;</h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {result.articles.map((a) => (
              <li key={a.slug} className="py-4">
                <Link href={`/help/${a.slug}`} className="font-medium text-primary underline-offset-2 hover:underline">
                  {a.title}
                </Link>
                <p className="mt-1 text-sm text-muted">{a.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.destinations.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold">Go straight to</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {result.destinations.map((d) => (
              <li key={d.href}>
                <Link href={d.href} className="block rounded-md border border-line-strong bg-surface p-4 hover:border-primary">
                  <span className="font-medium">{d.label}</span>
                  <span className="mt-1 block text-sm text-muted">{d.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {none ? (
        <div>
          <h2 className="text-lg font-semibold">Nothing matched &ldquo;{q}&rdquo;</h2>
          <p className="mt-2 max-w-[56ch] text-sm text-muted">Try fewer or different words, or start from one of these searches.</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {result.suggestions.map((s) => (
              <li key={s}>
                <Link href={`/help?q=${encodeURIComponent(s)}`} className="inline-block rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-sm hover:border-primary">
                  {s}
                </Link>
              </li>
            ))}
          </ul>
          <h3 className="mt-8 font-semibold">Popular articles</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {ARTICLES.slice(0, 4).map((a) => (
              <li key={a.slug}>
                <Link href={`/help/${a.slug}`} className="text-primary hover:underline">
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="border-t border-line pt-6 text-sm text-muted">
        Still stuck, or something is missing from the Help Centre?{" "}
        <Link href={`/contact?topic=feedback&subject=${encodeURIComponent(`Help Centre: ${q}`.slice(0, 120))}`} className="font-medium text-primary hover:underline">
          Tell us what you were looking for
        </Link>{" "}
        or{" "}
        <Link href="/contact" className="font-medium text-primary hover:underline">
          contact support
        </Link>
        .
      </div>
    </section>
  );
}

function Browse() {
  return (
    <div className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2">
      {CATEGORIES.map((c) => (
        <section key={c.id} aria-labelledby={`cat-${c.id}`}>
          <h2 id={`cat-${c.id}`} className="font-semibold">
            {c.title}
          </h2>
          <p className="mt-1 text-sm text-muted">{c.blurb}</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {ARTICLES.filter((a) => a.category === c.id).map((a) => (
              <li key={a.slug}>
                <Link href={`/help/${a.slug}`} className="text-primary underline-offset-2 hover:underline">
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
