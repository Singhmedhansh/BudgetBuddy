import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnabledProviders, parseProviders } from "./providers";

describe("parseProviders: only what Supabase reports as enabled is offered", () => {
  it("shows nothing social when neither provider is configured", () => {
    expect(parseProviders({ external: { google: false, github: false, email: true } })).toEqual({ social: [], email: true, phone: false });
  });
  it("shows exactly the configured providers", () => {
    expect(parseProviders({ external: { google: true, github: false, email: true } }).social).toEqual(["google"]);
    expect(parseProviders({ external: { google: true, github: true, email: true } }).social).toEqual(["google", "github"]);
  });
  it("offers Google, Apple and X in a fixed order, and phone only when it is strictly enabled", () => {
    expect(parseProviders({ external: { x: true, google: true, apple: true, email: true, phone: true } })).toEqual({ social: ["google", "apple", "x"], email: true, phone: true });
    expect(parseProviders({ external: { phone: "true" } }).phone).toBe(false);
  });
  it("ignores providers we do not support, and anything that is not strictly true", () => {
    expect(parseProviders({ external: { twitter: true, discord: true, google: "true", github: 1, apple: "yes" } }).social).toEqual([]);
  });
  it("treats malformed settings as nothing enabled but keeps email working", () => {
    expect(parseProviders(null)).toEqual({ social: [], email: true, phone: false });
    expect(parseProviders({})).toEqual({ social: [], email: true, phone: false });
  });
});

describe("getEnabledProviders: fails closed for social, open for email", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const env = () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  };
  it("reads the provider flags from the project settings", async () => {
    env();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ external: { google: true, github: false, email: true } }))));
    expect((await getEnabledProviders()).social).toEqual(["google"]);
  });
  it("hides social sign-in when the settings request fails or errors", async () => {
    env();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await getEnabledProviders()).toEqual({ social: [], email: true, phone: false });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await getEnabledProviders()).toEqual({ social: [], email: true, phone: false });
  });
  it("offers nothing when Supabase is not configured at all", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(await getEnabledProviders()).toEqual({ social: [], email: false, phone: false });
  });
});
