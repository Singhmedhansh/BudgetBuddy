const PRODUCTION_ORIGIN = "https://getfintrack.online";
type SiteEnv = {
  SEO_CANONICAL_ORIGIN?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
};

const clean = (v: string) => v.trim().replace(/\/$/, "");

/**
 * Public origin for metadata, canonical URLs and the index files. In order:
 * 1. SEO_CANONICAL_ORIGIN, an explicit setting for the environment that serves the official domain;
 * 2. NEXT_PUBLIC_SITE_URL, the general site URL;
 * 3. the official domain in Production;
 * 4. the deployment's own address for any other Vercel deployment;
 * 5. localhost, for local development only.
 */
export function siteOrigin(env: SiteEnv = process.env as SiteEnv): string {
  const seo = env.SEO_CANONICAL_ORIGIN?.trim();
  if (seo) return clean(seo);

  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return clean(configured);

  if (env.VERCEL_ENV === "production") return PRODUCTION_ORIGIN;

  const deployment = env.VERCEL_URL?.trim();
  if (deployment) return `https://${deployment.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  return "http://localhost:3100";
}
