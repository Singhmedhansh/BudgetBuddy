import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/components/help/RichText";
import { PublicPage } from "@/components/landing/PublicPage";
import { LEGAL_DOCS, LEGAL_UPDATED, legalBySlug } from "@/content/legal";

export function generateStaticParams() {
  return LEGAL_DOCS.map((d) => ({ doc: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const d = legalBySlug((await params).doc);
  return d ? { title: d.title, description: d.summary, alternates: { canonical: `/legal/${d.slug}` } } : {};
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const doc = legalBySlug((await params).doc);
  if (!doc) notFound();
  return (
    <PublicPage>
      <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      <p role="note" className="mt-6 rounded-md border border-warn/60 bg-warn/10 px-4 py-3 text-sm text-warn-text">
        This document is a draft for legal review. It describes the product as it works today and will be reviewed by qualified counsel before public launch.
      </p>
      <div className="mt-10 space-y-10">
        {doc.sections.map((s) => (
          <section key={s.heading} aria-labelledby={`h-${s.heading}`}>
            <h2 id={`h-${s.heading}`} className="mb-3 text-lg font-semibold">
              {s.heading}
            </h2>
            <ArticleBody blocks={s.blocks} />
          </section>
        ))}
      </div>
      <nav aria-label="Other policies" className="mt-14 border-t border-line pt-6">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {LEGAL_DOCS.filter((d) => d.slug !== doc.slug).map((d) => (
            <li key={d.slug}>
              <Link href={`/legal/${d.slug}`} className="text-primary hover:underline">
                {d.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </PublicPage>
  );
}
