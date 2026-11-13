import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchange = vi.fn();
const rpc = vi.fn(async (): Promise<{ data: unknown; error: null }> => ({ data: null, error: null }));
const eq = vi.fn(async () => ({ error: null }));
const update = vi.fn(() => ({ eq }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: exchange }, rpc, from: () => ({ update }) }) }));

import { GET } from "./route";

const call = (qs: string) => GET(new NextRequest(`http://127.0.0.1:3100/auth/callback?${qs}`));
const loc = (r: Response) => new URL(r.headers.get("location")!);

beforeEach(() => {
  exchange.mockReset();
  rpc.mockClear();
  update.mockClear();
  eq.mockClear();
});

describe.each(["google", "github"] as const)("%s OAuth callback", (provider) => {
  it("exchanges the code, ensures the profile, and lands on the requested page", async () => {
    exchange.mockResolvedValue({ data: { user: { id: "u1", identities: [{ provider, last_sign_in_at: "2026-01-01" }] } }, error: null });
    const res = await call(`provider=${provider}&code=abc&next=/app/transactions`);
    expect(loc(res).pathname).toBe("/app/transactions");
    expect(exchange).toHaveBeenCalledWith("abc");
    expect(rpc).toHaveBeenCalledWith("ensure_profile");
    expect(res.headers.get("set-cookie")).toContain(`bb-last-provider=${provider}`);
  });

  it("never follows an off-site next URL", async () => {
    exchange.mockResolvedValue({ data: { user: { id: "u1", identities: [] } }, error: null });
    const res = await call(`provider=${provider}&code=abc&next=https://evil.example/steal`);
    expect(loc(res).hostname).not.toBe("evil.example");
    expect(loc(res).pathname).toBe("/app");
  });

  it("a cancelled sign-in goes back to login with a fixed reason and creates no session", async () => {
    const res = await call(`provider=${provider}&error=access_denied&error_description=User+denied`);
    expect(loc(res).pathname).toBe("/login");
    expect(loc(res).searchParams.get("error")).toBe("cancelled");
    expect(loc(res).searchParams.get("provider")).toBe(provider);
    expect(exchange).not.toHaveBeenCalled();
  });

  it("a provider that is not enabled in Supabase is reported as unavailable, not as a crash", async () => {
    const res = await call(`provider=${provider}&error=server_error&error_description=Unsupported+provider:+provider+is+not+enabled`);
    expect(loc(res).searchParams.get("error")).toBe("disabled");
  });

  it("an expired or replayed code fails safely", async () => {
    exchange.mockResolvedValue({ data: { user: null }, error: { message: "invalid flow state, flow state has expired", code: "flow_state_expired" } });
    const res = await call(`provider=${provider}&code=stale`);
    expect(loc(res).pathname).toBe("/login");
    expect(loc(res).searchParams.get("error")).toBe("expired");
    expect(rpc).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie") ?? "").not.toContain("bb-last-provider");
  });

  it("a missing code is treated as an expired link", async () => {
    const res = await call(`provider=${provider}`);
    expect(loc(res).searchParams.get("error")).toBe("expired");
  });
});

describe("linking from Settings", () => {
  it("failures return to the connected-accounts page, not the login page", async () => {
    const res = await call("provider=github&next=/app/settings/connected&error=access_denied");
    expect(loc(res).pathname).toBe("/app/settings/connected");
  });
  it("an identity that belongs to someone else is reported plainly", async () => {
    exchange.mockResolvedValue({ data: { user: null }, error: { message: "Identity is already linked to another user", code: "identity_already_exists" } });
    const res = await call("provider=google&code=x&next=/app/settings/connected");
    expect(loc(res).searchParams.get("error")).toBe("linked_elsewhere");
  });
});

describe("an unknown provider name is ignored", () => {
  it("does not reflect it into the redirect", async () => {
    const res = await call("provider=%3Cscript%3E&error=access_denied");
    expect(loc(res).searchParams.get("provider")).toBeNull();
  });
});

describe("profile name from the provider", () => {
  const user = { id: "u1", identities: [], user_metadata: { full_name: "  Asha Rao  " } };
  it("pre-fills an empty name on first sign-in", async () => {
    exchange.mockResolvedValue({ data: { user }, error: null });
    rpc.mockResolvedValueOnce({ data: { display_name: null }, error: null });
    await call("provider=google&code=abc");
    expect(update).toHaveBeenCalledWith({ display_name: "Asha Rao" });
    expect(eq).toHaveBeenCalledWith("user_id", "u1");
  });
  it("never replaces a name the person already chose", async () => {
    exchange.mockResolvedValue({ data: { user }, error: null });
    rpc.mockResolvedValueOnce({ data: { display_name: "Asha" }, error: null });
    await call("provider=github&code=abc");
    expect(update).not.toHaveBeenCalled();
  });
});
