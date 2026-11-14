import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { siteOrigin } from "@/config/site-origin";

/** Locale of the product (prices are in rupees, copy is British English). */
export const LOCALE = "en_IN";

/** Every public, indexable page that has a fixed address. Help articles and legal documents are added from their own content. */
export const STATIC_PAGES = {
  home: {
    path: "/",
    title: `${BRAND.name} — Your Finances. In Focus.`,
    description:
      "Take control of your money with FinTrack. Track expenses, manage budgets, monitor savings goals, organise bills and understand your financial health in one place.",
    priority: 1,
    changeFrequency: "weekly",
  },
  help: {
    path: "/help",
    title: "Help Centre",
    description: "Step-by-step guides for adding accounts, recording and importing transactions, setting budgets and goals, and keeping your FinTrack data safe.",
    priority: 0.7,
    changeFrequency: "monthly",
  },
  security: {
    path: "/security",
    title: "Security and privacy",
    description: "How FinTrack protects your financial records with row-level access rules, private file storage and an audit trail, and what it deliberately does not do.",
    priority: 0.6,
    changeFrequency: "monthly",
  },
  contact: {
    path: "/contact",
    title: "Contact us",
    description: "Send the FinTrack support team a message and receive a reference number so you can follow up on your question.",
    priority: 0.5,
    changeFrequency: "yearly",
  },
} as const;

export type StaticPageKey = keyof typeof STATIC_PAGES;

const SHARE_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: `${BRAND.name}: ${BRAND.tagline}` };
const TWITTER_IMAGE = { url: "/twitter-image", width: 1200, height: 630, alt: SHARE_IMAGE.alt };

type PageSeo = {
  /** Page title. It is added to the site title template unless `absoluteTitle` is true. */
  title: string;
  description: string;
  /** Path starting with "/". The canonical URL is built from it. */
  path: string;
  absoluteTitle?: boolean;
  /** Keep the page out of search results (sign-in, sign-up, private app pages). */
  noindex?: boolean;
  type?: "website" | "article";
};

const fullTitle = (title: string, absolute?: boolean) => (absolute ? title : `${title} | ${BRAND.name}`);

/**
 * Metadata for one page. A page that sets its own Open Graph block replaces the layout's rather than merging
 * with it, so every field social previews need is written here, once.
 */
export function pageMetadata({ title, description, path, absoluteTitle, noindex, type = "website" }: PageSeo): Metadata {
  const shown = fullTitle(title, absoluteTitle);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    robots: noindex ? { index: false, follow: false, googleBot: { index: false, follow: false } } : { index: true, follow: true },
    openGraph: { type, url: path, siteName: BRAND.name, title: shown, description, locale: LOCALE, images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title: shown, description, images: [TWITTER_IMAGE] },
  };
}

/** Metadata for a page that must stay out of search results, such as sign-in or anything signed-in. */
export function privatePageMetadata(title: string, description: string = BRAND.description): Metadata {
  return {
    title,
    description,
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  };
}

export const staticPageMetadata = (key: StaticPageKey): Metadata => {
  const p = STATIC_PAGES[key];
  return pageMetadata({ title: p.title, description: p.description, path: p.path, absoluteTitle: key === "home" });
};

/** Same form the canonical tag resolves to (the home page has no trailing slash), so the sitemap and canonicals agree. */
export const absoluteUrl = (path: string) => `${siteOrigin()}${path === "/" ? "" : path}`;
