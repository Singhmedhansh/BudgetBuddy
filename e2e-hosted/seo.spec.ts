import { expect, test } from "@playwright/test";

// The origin the deployment should advertise in canonical tags, Open Graph URLs and the sitemap.
const ORIGIN = process.env.EXPECT_ORIGIN ?? "https://getfintrack.online";

const PUBLIC = ["/", "/help", "/help/getting-started", "/security", "/contact", "/legal/privacy", "/legal/terms", "/legal/billing"];
const PRIVATE = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/link-error"];

const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)="${key}"[^>]*content="([^"]*)"`, "i");
  return html.match(re)?.[1];
};

test.describe("rendered SEO on the hosted site", () => {
  const seen = { titles: new Set<string>(), descriptions: new Set<string>() };

  for (const path of PUBLIC) {
    test(`public ${path}: title, description, canonical, Open Graph, indexable`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const html = await res.text();
      const title = html.match(/<title>(.*?)<\/title>/s)?.[1];
      const description = meta(html, "description");
      expect(title, "title").toBeTruthy();
      expect(description, "description").toBeTruthy();
      expect(seen.titles.has(title!), `duplicate title ${title}`).toBe(false);
      expect(seen.descriptions.has(description!), "duplicate description").toBe(false);
      seen.titles.add(title!);
      seen.descriptions.add(description!);

      const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
      expect(canonical).toBe(path === "/" ? ORIGIN : `${ORIGIN}${path}`);
      expect(meta(html, "robots")).toBe("index, follow");
      expect(meta(html, "og:url")).toBe(canonical);
      expect(meta(html, "og:image")).toBe(`${ORIGIN}/opengraph-image`);
      expect(meta(html, "og:image:width")).toBe("1200");
      expect(meta(html, "og:image:height")).toBe("630");
      expect(meta(html, "og:site_name")).toBe("FinTrack");
      expect(meta(html, "twitter:card")).toBe("summary_large_image");
      expect(meta(html, "twitter:image")).toBe(`${ORIGIN}/twitter-image`);
      expect(html).toMatch(/<html[^>]*lang="en-IN"/);
      expect(html).not.toContain("localhost");
      expect(html).not.toMatch(/budget[\s-]buddy/i);
    });
  }

  for (const path of PRIVATE) {
    test(`private ${path}: noindex and no canonical`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      expect(meta(await res.text(), "robots")).toContain("noindex");
    });
  }

  test("the signed-in app and its endpoints send a noindex header, even when they redirect", async ({ request }) => {
    for (const path of ["/app", "/app/transactions", "/api/webhooks/razorpay"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.headers()["x-robots-tag"], path).toContain("noindex");
    }
  });

  test("structured data on the home page is valid JSON with no invented claims", async ({ request }) => {
    const html = await (await request.get("/")).text();
    const raw = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
    expect(raw).toBeTruthy();
    const data = JSON.parse(raw!);
    expect(data["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
    expect(raw).not.toMatch(/aggregateRating|review|ratingValue|award/);
  });

  test("robots.txt and sitemap.xml are valid and consistent", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(robots).toMatch(/Disallow: \/app/);
    expect(robots).not.toMatch(/Disallow: \/login/);

    const xml = await (await request.get("/sitemap.xml")).text();
    const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(25);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u.startsWith(ORIGIN), u).toBe(true);
    for (const hidden of ["/login", "/signup", "/app", "/reset-password"]) expect(urls.some((u) => new URL(u).pathname.startsWith(hidden)), hidden).toBe(false);

    // every sitemap URL really exists on this deployment
    for (const u of urls) {
      const res = await request.get(new URL(u).pathname);
      expect(res.status(), u).toBe(200);
    }
  });

  test("icons, manifest and the social images are served", async ({ request }) => {
    for (const [path, type] of [["/icon.svg", "image/svg+xml"], ["/apple-icon", "image/png"], ["/opengraph-image", "image/png"], ["/twitter-image", "image/png"], ["/manifest.webmanifest", "json"]] as const) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"], path).toContain(type);
    }
  });

  test("an unknown page is a real 404", async ({ request }) => {
    expect((await request.get("/definitely-not-a-page")).status()).toBe(404);
  });
});
