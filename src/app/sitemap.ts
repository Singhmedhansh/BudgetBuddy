import type { MetadataRoute } from "next";
import { ARTICLES } from "@/content/help/articles";
import { LEGAL_DOCS } from "@/content/legal";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Public, indexable pages only. The signed-in app is deliberately absent. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", "/help", "/contact", "/security", "/login", "/signup", ...ARTICLES.map((a) => `/help/${a.slug}`), ...LEGAL_DOCS.map((d) => `/legal/${d.slug}`)];
  return paths.map((p) => ({ url: `${SITE}${p}` }));
}
