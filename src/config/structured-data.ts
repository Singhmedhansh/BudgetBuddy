import { BRAND } from "@/config/brand";
import { absoluteUrl } from "@/config/seo";

/**
 * Structured data for the home page. It states only what is true and visible on the site:
 * no ratings, reviews, awards or user counts. The paid plan is not yet purchasable, so it is
 * deliberately not described as an offer; only the free plan is.
 */
export function homeStructuredData() {
  const origin = absoluteUrl("/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${origin}/#organization`,
        name: BRAND.name,
        url: origin,
        logo: absoluteUrl("/icon.svg"),
        description: BRAND.description,
      },
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: BRAND.name,
        url: origin,
        description: BRAND.description,
        inLanguage: "en-IN",
        publisher: { "@id": `${origin}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}/#app`,
        name: BRAND.name,
        url: origin,
        description: BRAND.description,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        inLanguage: "en-IN",
        publisher: { "@id": `${origin}/#organization` },
        offers: { "@type": "Offer", name: "FinTrack Free", price: "0", priceCurrency: "INR" },
      },
    ],
  };
}

/** JSON for a <script type="application/ld+json"> tag. "<" is escaped so content can never close the tag early. */
export const jsonLdString = (data: unknown) => JSON.stringify(data).replace(/</g, String.raw`\u003c`);
