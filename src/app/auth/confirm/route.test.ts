/** Invalid, expired and valid recovery / confirmation tokens at the email-link route. */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECOVERY_COOKIE } from "@/lib/auth/recovery-guard";

const supabase = {
  auth: { verifyOtp: vi.fn(), getUser: vi.fn() },
  rpc: vi.fn(async () => ({ data: null, error: null })),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));

const { GET } = await import("./route");
const call = (qs: string) => GET(new NextRequest(`http://localhost:3100/auth/confirm?${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("/auth/confirm", () => {
  it("an invalid or expired recovery token goes to the explanatory page and sets no recovery cookie", async () => {
    supabase.auth.verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    const res = await call("token_hash=bogus&type=recovery&next=/app");
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/auth/link-error");
    expect(loc.searchParams.get("kind")).toBe("reset");
    expect(res.cookies.get(RECOVERY_COOKIE)).toBeUndefined();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("an invalid confirmation token explains how to get a new one", async () => {
    supabase.auth.verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const loc = new URL((await call("token_hash=bogus&type=signup")).headers.get("location")!);
    expect(loc.pathname).toBe("/auth/link-error");
    expect(loc.searchParams.get("kind")).toBe("confirm");
  });

  it("a missing token or type is treated as invalid without calling the provider", async () => {
    expect(new URL((await call("type=recovery")).headers.get("location")!).pathname).toBe("/auth/link-error");
    expect(new URL((await call("token_hash=x")).headers.get("location")!).pathname).toBe("/auth/link-error");
    expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("a valid recovery token sets a short-lived httpOnly recovery cookie and goes to the reset page", async () => {
    supabase.auth.verifyOtp.mockResolvedValue({ error: null });
    const res = await call("token_hash=good&type=recovery");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/reset-password");
    const c = res.cookies.get(RECOVERY_COOKIE);
    expect(c?.value.startsWith("u1.")).toBe(true);
    expect(c?.httpOnly).toBe(true);
    expect(c?.maxAge).toBe(900);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("a valid signup confirmation creates the profile, sets NO recovery cookie, and ignores unsafe next targets", async () => {
    supabase.auth.verifyOtp.mockResolvedValue({ error: null });
    const res = await call("token_hash=good&type=signup&next=//evil.example");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/app");
    expect(res.cookies.get(RECOVERY_COOKIE)).toBeUndefined();
    expect(supabase.rpc).toHaveBeenCalledWith("ensure_profile");
  });
});
