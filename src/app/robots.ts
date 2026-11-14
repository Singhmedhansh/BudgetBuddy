import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/config/seo";

/**
 * Sign-in and sign-up stay crawlable on purpose: they carry a noindex tag, and a crawler can only obey it
 * if it is allowed to fetch the page. The signed-in app, API and auth endpoints serve no public content.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/api/", "/auth/"] },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
