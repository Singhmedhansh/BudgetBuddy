import { describe, expect, it } from "vitest";
import { canonicalHostRedirect } from "./canonical-host";

describe("canonicalHostRedirect", () => {
  it("redirects www to the HTTPS apex and preserves path and query", () => {
    expect(canonicalHostRedirect(new URL("http://www.getfintrack.online/help?q=budget"))?.toString())
      .toBe("https://getfintrack.online/help?q=budget");
  });

  it("does not redirect the apex or unrelated hosts", () => {
    expect(canonicalHostRedirect(new URL("https://getfintrack.online/"))).toBeNull();
    expect(canonicalHostRedirect(new URL("https://example.test/"))).toBeNull();
  });

  it("also recognises www from the forwarded host and host headers, including a port", () => {
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
    const local = new URL("http://localhost:3300/help?x=1");
    expect(canonicalHostRedirect(local, h({ "x-forwarded-host": "www.getfintrack.online" }))?.toString()).toBe("https://getfintrack.online/help?x=1");
    expect(canonicalHostRedirect(local, h({ host: "WWW.getfintrack.online:443" }))?.toString()).toBe("https://getfintrack.online/help?x=1");
    expect(canonicalHostRedirect(local, h({ host: "getfintrack.online" }))).toBeNull();
  });
});
