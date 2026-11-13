/**
 * Password-reset isolation. Regression for the incident where the reset form
 * changed a password for an ordinary signed-in session that had not come
 * through a reset link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeRecoveryToken, RECOVERY_COOKIE } from "@/lib/auth/recovery-guard";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const store = new Map<string, string>();
const supabase = {
  auth: {
    getUser: vi.fn(),
    updateUser: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(),
  },
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (store.has(n) ? { name: n, value: store.get(n)! } : undefined),
    set: (n: string, v: string) => void store.set(n, v),
    delete: (n: string) => void store.delete(n),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabase }));

const { updatePassword, requestPasswordReset } = await import("./actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const GOOD = { password: "Correct-Horse-Battery-9", confirm: "Correct-Horse-Battery-9" };

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

describe("updatePassword requires a verified reset link", () => {
  it("refuses with no session at all", async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    const r = await updatePassword(undefined, form(GOOD));
    expect(r.error).toMatch(/expired/);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("INCIDENT: refuses an ordinary signed-in session without the recovery cookie", async () => {
    const r = await updatePassword(undefined, form(GOOD));
    expect(r.error).toMatch(/expired/);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it("refuses a recovery cookie issued for a different user", async () => {
    store.set(RECOVERY_COOKIE, makeRecoveryToken("22222222-2222-2222-2222-222222222222", Date.now()));
    const r = await updatePassword(undefined, form(GOOD));
    expect(r.error).toMatch(/expired/);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses an expired recovery cookie", async () => {
    store.set(RECOVERY_COOKIE, makeRecoveryToken(USER_ID, Date.now() - 20 * 60 * 1000));
    const r = await updatePassword(undefined, form(GOOD));
    expect(r.error).toMatch(/expired/);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a malformed recovery cookie", async () => {
    store.set(RECOVERY_COOKIE, "not-a-token");
    expect((await updatePassword(undefined, form(GOOD))).error).toMatch(/expired/);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("with a valid recovery cookie: updates once, revokes other sessions, clears the cookie", async () => {
    store.set(RECOVERY_COOKIE, makeRecoveryToken(USER_ID, Date.now()));
    await expect(updatePassword(undefined, form(GOOD))).rejects.toThrow("REDIRECT:/app");
    expect(supabase.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(store.has(RECOVERY_COOKIE)).toBe(false);
  });

  it("a valid cookie still cannot set a weak or mismatched password", async () => {
    store.set(RECOVERY_COOKIE, makeRecoveryToken(USER_ID, Date.now()));
    const weak = await updatePassword(undefined, form({ password: "short", confirm: "short" }));
    expect(weak.fieldErrors?.password).toBeTruthy();
    const mismatch = await updatePassword(undefined, form({ password: GOOD.password, confirm: "Different-Pass-12345" }));
    expect(mismatch.fieldErrors?.confirm).toMatch(/match/);
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("requestPasswordReset does not reveal whether an account exists", () => {
  it("returns the same notice whether or not the provider reports an error", async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    const known = await requestPasswordReset(undefined, form({ email: "a@example.com" }));
    supabase.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { code: "user_not_found", status: 400 } });
    const unknown = await requestPasswordReset(undefined, form({ email: "b@example.com" }));
    expect(known.notice).toBeTruthy();
    expect(unknown.notice).toBe(known.notice);
    expect(unknown.error).toBeUndefined();
  });
  it("only surfaces rate limiting", async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { code: "over_email_send_rate_limit", status: 429 } });
    const r = await requestPasswordReset(undefined, form({ email: "a@example.com" }));
    expect(r.error).toMatch(/Too many/);
  });
});
