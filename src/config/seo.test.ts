import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { ARTICLES } from "@/content/help/articles";
import { LEGAL_DOCS } from "@/content/legal";
import { STATIC_PAGES, pageMetadata, privatePageMetadata, staticPageMetadata } from "./seo";
import { homeStructuredData, jsonLdString } from "./structured-data";

const ORIGIN = "https://getfintrack.online";
const titleOf = (m: ReturnType<typeof pageMetadata>) => (typeof m.title === "string" ? m.title : (m.title as { absolute: string }).absolute);

const all = [
  ...Object.values(STATIC_PAGES).map((p) => ({ path: p.path, title: p.title, description: p.description })),
  ...ARTICLES.map((a) => ({ path: `/help/${a.slug}`, title: a.title, description: a.summary })),
  ...LEGAL_DOCS.map((d) => ({ path: `/legal/${d.slug}`, title: d.title, description: d.summary })),
];

describe("public page metadata", () => {
  it("gives every public page a unique title and a unique description", () => {
    expect(new Set(all.map((p) => p.title)).size).toBe(all.length);
    expect(new Set(all.map((p) => p.description)).size).toBe(all.length);
  });

  it("writes real descriptions, not stubs", () => {
    for (const p of all) expect(p.description.length, p.path).toBeGreaterThanOrEqual(30);
  });

  it("uses the agreed home title and description", () => {
    expect(STATIC_PAGES.home.title).toBe("FinTrack — Your Finances. In Focus.");
    expect(STATIC_PAGES.home.description).toMatch(/^Take control of your money with FinTrack\./);
  });

  it("sets a canonical path, Open Graph and Twitter card on every page", () => {
    for (const p of all) {
      const m = pageMetadata({ title: p.title, description: p.description, path: p.path });
      expect(m.alternates?.canonical, p.path).toBe(p.path);
      expect(m.openGraph, p.path).toMatchObject({ url: p.path, siteName: "FinTrack", locale: "en_IN" });
      expect(m.twitter, p.path).toMatchObject({ card: "summary_large_image" });
      expect(m.robots).toMatchObject({ index: true });
    }
  });

  it("does not repeat the site name in the home title and does append it elsewhere", () => {
    expect(titleOf(staticPageMetadata("home"))).toBe("FinTrack — Your Finances. In Focus.");
    expect(pageMetadata({ title: "Help Centre", description: "x".repeat(40), path: "/help" }).openGraph).toMatchObject({ title: "Help Centre | FinTrack" });
  });

  it("marks private pages noindex", () => {
    expect(privatePageMetadata("Log in").robots).toMatchObject({ index: false, follow: false });
  });
});

describe("indexing and private routes", () => {
  const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

  it("keeps every sign-in, sign-up and password page noindex", () => {
    for (const f of ["src/app/(auth)/login/page.tsx", "src/app/(auth)/signup/page.tsx", "src/app/(auth)/forgot-password/page.tsx", "src/app/(auth)/reset-password/page.tsx", "src/app/auth/link-error/page.tsx"]) {
      expect(src(f), f).toContain("privatePageMetadata(");
    }
  });

  it("keeps the whole signed-in app noindex, in the layout and in a response header", () => {
    expect(src("src/app/app/layout.tsx")).toContain("privatePageMetadata(");
    expect(src("next.config.ts")).toContain("X-Robots-Tag");
  });

  it("lists only public, indexable pages in the sitemap, all on the canonical origin", () => {
    const urls = sitemap().map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u.startsWith(ORIGIN) || u.startsWith("http"), u).toBe(true);
    const paths = urls.map((u) => new URL(u).pathname);
    for (const hidden of ["/login", "/signup", "/forgot-password", "/reset-password", "/app", "/auth", "/api"]) {
      expect(paths.some((p) => p === hidden || p.startsWith(`${hidden}/`)), hidden).toBe(false);
    }
    expect(paths).toEqual(expect.arrayContaining(["/", "/help", "/security", "/contact", "/legal/privacy", "/help/" + ARTICLES[0].slug]));
    expect(paths.length).toBe(all.length);
  });

  it("points robots.txt at the sitemap and blocks only private areas", () => {
    const r = robots();
    expect(r.sitemap).toMatch(/\/sitemap\.xml$/);
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.disallow).toEqual(["/app", "/api/", "/auth/"]);
    expect(rule.disallow).not.toContain("/login");
  });
});

describe("structured data", () => {
  const graph = homeStructuredData()["@graph"];
  const types = graph.map((n) => n["@type"]);

  it("describes the organisation, the website and the application", () => {
    expect(types).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
  });

  it("invents no reviews, ratings, awards or counts", () => {
    const text = JSON.stringify(homeStructuredData());
    for (const banned of ["aggregateRating", "review", "ratingValue", "award", "userCount", "interactionStatistic"]) expect(text).not.toContain(banned);
  });

  it("offers only the free plan, because the paid plan cannot be bought yet", () => {
    const app = graph.find((n) => n["@type"] === "SoftwareApplication") as { offers: { price: string; priceCurrency: string } };
    expect(app.offers).toMatchObject({ price: "0", priceCurrency: "INR" });
  });

  it("is valid JSON that can never close its own script tag", () => {
    const out = jsonLdString({ x: "</script><b>" });
    expect(out).not.toContain("</script");
    expect(JSON.parse(out).x).toBe("</script><b>");
  });
});
