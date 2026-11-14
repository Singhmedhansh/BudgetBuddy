const WWW_HOST = "www.getfintrack.online";
const CANONICAL_HOST = "getfintrack.online";

/** Returns a permanent canonical URL for the www alias, or null for other hosts. */
export function canonicalHostRedirect(url: URL): URL | null {
  if (url.hostname.toLowerCase() !== WWW_HOST) return null;
  const target = new URL(url);
  target.hostname = CANONICAL_HOST;
  target.protocol = "https:";
  return target;
}
