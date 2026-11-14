import { describe, expect, it } from "vitest";
import { siteOrigin } from "./site-origin";

describe("siteOrigin", () => {
  it("uses an explicit configured URL in every environment", () => {
    expect(siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://example.test/", VERCEL_ENV: "production" })).toBe("https://example.test");
  });

  it("uses the official canonical URL in production when unset", () => {
    expect(siteOrigin({ VERCEL_ENV: "production" })).toBe("https://getfintrack.online");
  });

  it("lets an explicit SEO origin win over every other setting", () => {
    expect(siteOrigin({ SEO_CANONICAL_ORIGIN: "https://getfintrack.online/", NEXT_PUBLIC_SITE_URL: "https://other.test", VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" })).toBe("https://getfintrack.online");
  });

  it("uses the deployment hostname for previews", () => {
    expect(siteOrigin({ VERCEL_ENV: "preview", VERCEL_URL: "fintrack-git-feature.example.vercel.app" })).toBe("https://fintrack-git-feature.example.vercel.app");
  });

  it("uses localhost only for local development", () => {
    expect(siteOrigin({})).toBe("http://localhost:3100");
  });
});
