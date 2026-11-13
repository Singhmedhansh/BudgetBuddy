import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnabledProviders, parseProviders } from "./providers";

describe("parseProviders: only what Supabase reports as enabled is offered", () => {
  it("shows nothing social when neither provider is configured", () => {
    expect(parseProviders({ external: { google: false, github: false, email: true } })).toEqual({ social: [], email: true });
  });
  it("shows exactly the configured providers", () => {
    expect(parseProviders({ external: { google: true, github: false, email: true } }).social).toEqual(["google"]);
    expect(parseProviders({ external: { google: true, github: true, email: true } }).social).toEqual(["google", "github"]);
  });
  it("ignores providers we do not support, and anything that is not strictly true", () => {
    expect(parseProviders({ external: { apple: true, google: "true", github: 1 } }).social).toEqual([]);
  });
  it("treats malformed settings as nothing enabled but keeps email working", () => {
    expect(parseProviders(null)).toEqual({ social: [], email: true });
    expect(parseProviders({})).toEqual({ social: [], email: true });
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
    expect(await getEnabledProviders()).toEqual({ social: [], email: true });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await getEnabledProviders()).toEqual({ social: [], email: true });
  });
  it("offers nothing when Supabase is not configured at all", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(await getEnabledProviders()).toEqual({ social: [], email: false });
  });
});
