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
});
