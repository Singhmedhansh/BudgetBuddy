/**
 * No dead links: every internal link in the landing page, header/footer, app
 * navigation, help content and in-page help links must resolve to a real page.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLES } from "@/content/help/articles";

const APP_DIR = join(process.cwd(), "src/app");

function pages(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const seg = /^\(.*\)$/.test(name) ? "" : `/${name}`;
      out.push(...pages(full, base + seg));
    } else if (name === "page.tsx") out.push(base || "/");
    else if (name === "route.ts") out.push(base || "/");
  }
  return out;
}
const ROUTES = pages(APP_DIR);
const toRegex = (route: string) => new RegExp("^" + route.replace(/\[[^\]]+\]/g, "[^/]+") + "$");
const exists = (href: string) => ROUTES.some((r) => toRegex(r).test(href.split("#")[0].split("?")[0] || "/"));

function linksIn(file: string): string[] {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  const hrefs = [...src.matchAll(/href[=:]\s*[{]?["'](\/[^"'`$]*)["']/g)].map((m) => m[1]);
  return hrefs;
}

describe("route integrity", () => {
  it("finds the pages it expects", () => {
    for (const r of ["/", "/help", "/help/[slug]", "/contact", "/security", "/legal/[doc]", "/login", "/signup", "/app", "/app/budgets/new"]) {
      expect(ROUTES, r).toContain(r);
    }
  });

  it.each([
    "src/components/landing/SiteChrome.tsx",
    "src/app/page.tsx",
    "src/components/app/AppNav.tsx",
    "src/components/app/nav-items.ts",
    "src/app/app/more/page.tsx",
    "src/app/app/layout.tsx",
    "src/app/help/page.tsx",
    "src/components/auth/forms.tsx",
  ])("every internal link in %s resolves to a page", (file) => {
    const links = linksIn(file);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(exists(l), `${file} -> ${l}`).toBe(true);
  });

  it("every help article slug has a page and contextual help links point at real articles", () => {
    for (const a of ARTICLES) expect(exists(`/help/${a.slug}`)).toBe(true);
    for (const f of ["src/app/app/page.tsx", "src/app/app/budgets/page.tsx", "src/app/app/accounts/page.tsx", "src/app/app/transactions/page.tsx", "src/app/app/goals/page.tsx", "src/app/app/calendar/page.tsx", "src/app/app/debt/page.tsx", "src/app/app/analytics/page.tsx", "src/app/app/import/page.tsx", "src/components/app/RecurringList.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      for (const m of src.matchAll(/help=\{\{ slug: "([^"]+)"/g)) expect(ARTICLES.some((a) => a.slug === m[1]), `${f} -> ${m[1]}`).toBe(true);
    }
  });

  it("legal pages linked from the footer exist for every document", async () => {
    const { LEGAL_DOCS } = await import("@/content/legal");
    for (const d of LEGAL_DOCS) expect(exists(`/legal/${d.slug}`)).toBe(true);
    const footer = readFileSync(join(process.cwd(), "src/components/landing/SiteChrome.tsx"), "utf8");
    for (const d of LEGAL_DOCS) expect(footer, d.slug).toContain(`/legal/${d.slug}`);
  });
});
