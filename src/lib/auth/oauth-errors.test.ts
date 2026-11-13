import { describe, expect, it } from "vitest";
import { isOAuthReason, lastProviderOf, oauthMessage, oauthReason } from "./oauth-errors";

describe("oauthReason classifies provider failures", () => {
  it.each([
    [{ error: "access_denied" }, "cancelled"],
    [{ code: "identity_already_exists" }, "linked_elsewhere"],
    [{ description: "Unsupported provider: provider is not enabled" }, "disabled"],
    [{ description: "Email not verified by provider" }, "unverified"],
    [{ description: "Signups not allowed for this instance" }, "no_account"],
    [{ code: "over_request_rate_limit" }, "rate_limited"],
    [{ code: "otp_expired" }, "expired"],
    [{ error: "something strange" }, "failed"],
  ])("%j -> %s", (input, reason) => expect(oauthReason(input)).toBe(reason));
});

describe("messages never echo provider text and name the provider", () => {
  it("uses the provider name for Google and GitHub", () => {
    expect(oauthMessage("cancelled", "github")).toContain("GitHub");
    expect(oauthMessage("linked_elsewhere", "google")).toContain("Google");
  });
  it("a crafted ?error= value cannot display arbitrary text", () => {
    expect(isOAuthReason("<b>Your account is locked, call 555</b>")).toBe(false);
    expect(oauthMessage("<b>Your account is locked</b>")).not.toContain("locked");
    expect(oauthMessage(undefined)).toBe("");
  });
});

describe("lastProviderOf", () => {
  it("prefers the most recently used identity", () => {
    expect(lastProviderOf({ identities: [{ provider: "email", last_sign_in_at: "2026-01-01" }, { provider: "github", last_sign_in_at: "2026-03-01" }] })).toBe("github");
    expect(lastProviderOf({ app_metadata: { provider: "google" } })).toBe("google");
    expect(lastProviderOf({})).toBe("email");
  });
});
