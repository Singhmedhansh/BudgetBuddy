import type { MetadataRoute } from "next";
import { ARTICLES } from "@/content/help/articles";
import { LEGAL_DOCS } from "@/content/legal";
import { STATIC_PAGES, absoluteUrl } from "@/config/seo";

/**
 * Public, indexable pages only. Sign-in, sign-up, password pages and the signed-in app are noindex and left out,
 * so every entry here is a page that is meant to appear in search results.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...Object.values(STATIC_PAGES).map((p) => ({ url: absoluteUrl(p.path), changeFrequency: p.changeFrequency, priority: p.priority })),
    ...ARTICLES.map((a) => ({ url: absoluteUrl(`/help/${a.slug}`), changeFrequency: "monthly" as const, priority: 0.6 })),
    ...LEGAL_DOCS.map((d) => ({ url: absoluteUrl(`/legal/${d.slug}`), changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
