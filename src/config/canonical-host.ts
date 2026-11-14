const WWW_HOST = "www.getfintrack.online";
const CANONICAL_HOST = "getfintrack.online";

const bareHost = (h: string | null | undefined) => (h ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");

/**
 * Returns a permanent canonical URL for the www alias, or null for every other host.
 * The host is read from the URL and, when given, from the request's forwarded-host and host headers,
 * because behind a proxy the public hostname is carried by the headers.
 */
export function canonicalHostRedirect(url: URL, headers?: { get(name: string): string | null }): URL | null {
  const hosts = [url.hostname, bareHost(headers?.get("x-forwarded-host")), bareHost(headers?.get("host"))].map((h) => h.toLowerCase());
  if (!hosts.includes(WWW_HOST)) return null;
  const target = new URL(url);
  target.hostname = CANONICAL_HOST;
  target.protocol = "https:";
  target.port = "";
  return target;
}
