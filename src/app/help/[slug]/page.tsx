import type { Metadata } from "next";
import { pageMetadata } from "@/config/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/components/help/RichText";
import { FeedbackForm } from "@/components/help/FeedbackForm";
import { PublicPage } from "@/components/landing/PublicPage";
import { ARTICLES, CATEGORIES, bySlug } from "@/content/help/articles";

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const a = bySlug((await params).slug);
  if (!a) return {};
  return pageMetadata({ title: a.title, description: a.summary, path: `/help/${a.slug}`, type: "article" });
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = bySlug((await params).slug);
  if (!article) notFound();
  const category = CATEGORIES.find((c) => c.id === article.category)!;
  const related = (article.related ?? []).map(bySlug).filter((a): a is NonNullable<typeof a> => !!a);

  return (
    <PublicPage>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/help" className="hover:text-fg">
              Help Centre
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page">{category.title}</li>
        </ol>
      </nav>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{article.title}</h1>
      <p className="mt-2 max-w-[60ch] text-muted">{article.summary}</p>
      <div className="mt-8">
        <ArticleBody blocks={article.body} />
      </div>

      {article.destination ? (
        <Link href={article.destination.href} className="mt-8 inline-block rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover">
          {article.destination.label}
        </Link>
      ) : null}

      <div className="mt-12 border-t border-line pt-8">
        <FeedbackForm slug={article.slug} />
      </div>

      {related.length > 0 ? (
        <section aria-labelledby="related" className="mt-10">
          <h2 id="related" className="font-semibold">
            Related articles
          </h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={`/help/${r.slug}`} className="text-primary hover:underline">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PublicPage>
  );
}
