import { beforeEach, describe, expect, it, vi } from "vitest";

// ───────── fakes ─────────
const calls: string[] = [];
const log = (s: string) => calls.push(s);
let updates: { table: string; payload: Record<string, unknown> }[] = [];
let updateError: { code?: string; message?: string } | null = null;

const storageRemove = vi.fn(async (paths: string[]): Promise<{ data: unknown[] | null; error: null | { message: string } }> => (log(`storage.remove:${paths.join(",")}`), { data: [], error: null }));
const storageList = vi.fn(async (): Promise<{ data: { name: string; id: string | null }[]; error: null | { message: string } }> => ({ data: [{ name: "a.pdf", id: "1" }], error: null }));
const updateUser = vi.fn(async () => ({ error: null as null | { code?: string; status?: number; message: string } }));
const signOut = vi.fn(async () => ({ error: null }));
const unlinkIdentity = vi.fn(async () => ({ error: null }));
let identities: { provider: string; identity_id: string }[] = [];
let rpcResults: Record<string, { data: unknown; error: null | { message: string } }> = {};

const supabase = {
  from: (table: string) => ({
    update: (payload: Record<string, unknown>) => ({ eq: async () => (updates.push({ table, payload }), { error: updateError }) }),
    select: () => ({ eq: () => ({ eq: async () => ({ data: [{ space_id: "s1" }], error: null }) }) }),
  }),
  rpc: vi.fn(async (name: string) => (log(`rpc:${name}`), rpcResults[name] ?? { data: null, error: null })),
  storage: { from: () => ({ list: storageList, remove: storageRemove }) },
  auth: { updateUser, signOut, unlinkIdentity, getUserIdentities: async () => ({ data: { identities } }) },
};

let user: Record<string, unknown>;
let profile: Record<string, unknown>;
const getContext = vi.fn(async () => ({ supabase, user, profile }));
vi.mock("@/server/context", () => ({ getContext: () => getContext(), ACTIVE_SPACE_COOKIE: "bb-space" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Hermetic: siteUrl() prefers NEXT_PUBLIC_SITE_URL when set, which differs between a developer machine and CI. Unset it so the
// mocked request host below is what the links are built from.
vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: vi.fn() }), headers: async () => new Headers({ host: "127.0.0.1:3100" }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
const verifyPassword = vi.fn<(email: string, password: string) => Promise<boolean>>(async () => true);
vi.mock("@/server/account", async (orig) => ({ ...(await orig<typeof import("@/server/account")>()), verifyPassword: (e: string, p: string) => verifyPassword(e, p) }));
const adminDelete = vi.fn(async () => ({ error: null as null | { message: string } }));
let adminEnabled = false;
let deleteAuthFlag = false;
vi.mock("@/server/admin", () => ({
  createAdminClient: () => (adminEnabled ? { auth: { admin: { deleteUser: adminDelete } }, storage: { from: () => ({ list: storageList, remove: storageRemove }) } } : null),
  deleteAuthUserEnabled: () => deleteAuthFlag,
}));

import {
  changePasswordAction,
  deleteAccountAction,
  dismissProfileBannerAction,
  requestEmailChangeAction,
  unlinkProviderAction,
  updateNotificationsAction,
  updatePreferencesAction,
  updateProfileAction,
} from "./settings-actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const PW = "Correct-horse-battery-9!";

beforeEach(() => {
  calls.length = 0;
  updates = [];
  updateError = null;
  identities = [{ provider: "email", identity_id: "i1" }];
  rpcResults = {};
  adminEnabled = false;
  deleteAuthFlag = false;
  vi.clearAllMocks();
  verifyPassword.mockResolvedValue(true);
  storageList.mockResolvedValue({ data: [{ name: "a.pdf", id: "1" }], error: null });
  user = { id: "u1", email: "asha@example.test", identities: [{ provider: "email" }], last_sign_in_at: new Date().toISOString() };
  profile = { user_id: "u1", display_name: null, country: null, persona: null, date_format: null, currency: "INR", timezone: "Asia/Kolkata", profile_completed_at: null };
});

describe("settings access control", () => {
  const actions: [string, () => Promise<unknown>][] = [
    ["updateProfile", () => updateProfileAction(undefined, form({ name: "x" }))],
    ["updatePreferences", () => updatePreferencesAction(undefined, form({}))],
    ["updateNotifications", () => updateNotificationsAction(undefined, form({}))],
    ["changePassword", () => changePasswordAction(undefined, form({}))],
    ["requestEmailChange", () => requestEmailChangeAction(undefined, form({ email: "a@b.co" }))],
    ["unlinkProvider", () => unlinkProviderAction(undefined, form({ provider: "google" }))],
    ["deleteAccount", () => deleteAccountAction(undefined, form({ confirm: "DELETE" }))],
    ["dismissBanner", () => dismissProfileBannerAction()],
  ];
  it.each(actions)("%s is refused when nobody is signed in, before touching any data", async (_n, run) => {
    getContext.mockRejectedValueOnce(new Error("REDIRECT:/login"));
    await expect(run()).rejects.toThrow("REDIRECT:/login");
    expect(updates).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("writes only the signed-in person's own row", async () => {
    await updateNotificationsAction(undefined, form({ budget_alerts: "on" }));
    expect(updates[0].table).toBe("profiles");
  });
});

describe("profile updates and completion", () => {
  const complete = { name: "Asha Rao", country: "IN", persona: "professional", currency: "INR", timezone: "Asia/Kolkata", date_format: "dmy", phone: "" };

  it("a complete profile is stamped complete and persisted", async () => {
    const r = await updateProfileAction(undefined, form(complete));
    expect(r.notice).toBe("Saved. Your profile is complete.");
    expect(updates[0].payload).toMatchObject({ display_name: "Asha Rao", country: "IN", persona: "professional", date_format: "dmy", phone: null });
    expect(updates[0].payload.profile_completed_at).toEqual(expect.any(String));
  });

  it("a partial save is accepted, stays pending and says what is left", async () => {
    const r = await updateProfileAction(undefined, form({ ...complete, country: "", persona: "", date_format: "" }));
    expect(r.error).toBeUndefined();
    expect(r.notice).toBe("Saved. 3 details left to finish your profile.");
    expect(updates[0].payload.profile_completed_at).toBeNull();
    expect(updates[0].payload.display_name).toBe("Asha Rao");
  });

  it("keeps the original completion time when already complete and saved again", async () => {
    profile = { ...profile, display_name: "Asha", country: "IN", persona: "professional", date_format: "dmy", profile_completed_at: "2026-01-02T00:00:00.000Z" };
    await updateProfileAction(undefined, form({ ...complete, name: "Asha R" }));
    expect(updates[0].payload.profile_completed_at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("emptying a required field it previously held cannot leave the profile marked complete", async () => {
    profile = { ...profile, display_name: "Asha", country: "IN", persona: "professional", date_format: "dmy", profile_completed_at: "2026-01-02T00:00:00.000Z" };
    // A blank field keeps the stored value, so completion cannot be lost by accident, and the stamp stays consistent with the data.
    const r = await updateProfileAction(undefined, form({ ...complete, country: "" }));
    expect(r.notice).toBe("Saved. Your profile is complete.");
    expect(updates[0].payload.country).toBe("IN");
  });

  it.each([
    ["an unknown country", { country: "Atlantis" }, "country"],
    ["an unknown date format", { date_format: "yyyy" }, "date_format"],
    ["a currency that is not offered", { currency: "XXX" }, "currency"],
    ["a bad timezone", { timezone: "Mars/Phobos" }, "timezone"],
    ["a phone number with letters", { phone: "call me" }, "phone"],
    ["a name over 80 characters", { name: "x".repeat(81) }, "name"],
  ])("rejects %s without saving", async (_n, patch, field) => {
    const r = await updateProfileAction(undefined, form({ ...complete, ...patch }));
    expect(r.fieldErrors?.[field]).toBeTruthy();
    expect(r.fieldErrors?.[field]).not.toMatch(/Invalid input/);
    expect(updates).toHaveLength(0);
  });

  it("echoes what was typed after an error so nothing is lost", async () => {
    const r = await updateProfileAction(undefined, form({ ...complete, phone: "nope" }));
    expect(r.values?.name).toBe("Asha Rao");
  });

  it("says plainly when the database update has not been applied yet", async () => {
    updateError = { code: "42703", message: 'column "country" of relation "profiles" does not exist' };
    const r = await updateProfileAction(undefined, form(complete));
    expect(r.error).toMatch(/database update has not been applied/);
  });
});

describe("dismissing the banner", () => {
  it("snoozes the reminder and never writes completion", async () => {
    await dismissProfileBannerAction();
    expect(updates[0].payload.banner_dismissed_until).toEqual(expect.any(String));
    expect(updates[0].payload).not.toHaveProperty("profile_completed_at");
    expect(new Date(updates[0].payload.banner_dismissed_until as string).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("preferences persistence", () => {
  const base = { theme: "dark", currency: "USD", timezone: "UTC", date_format: "mdy", number_format: "en-US" };
  it("writes every dashboard section explicitly, so an unticked box really turns it off", async () => {
    await updatePreferencesAction(undefined, form({ ...base, dash_trend: "on", dash_recent: "on" }));
    expect(updates[0].payload).toMatchObject({ theme: "dark", currency: "USD", number_format: "en-US", dashboard_prefs: { trend: true, categories: false, budgets: false, recent: true } });
  });
  it("a blank date format is stored as not chosen, so it cannot complete the profile", async () => {
    await updatePreferencesAction(undefined, form({ ...base, date_format: "" }));
    expect(updates[0].payload.date_format).toBeNull();
  });
  it("rejects values the database would refuse", async () => {
    const r = await updatePreferencesAction(undefined, form({ ...base, number_format: "xx" }));
    expect(r.fieldErrors?.number_format).toBeTruthy();
    expect(updates).toHaveLength(0);
  });
  it("saves notification choices as booleans and leaves security notices out of the stored choices", async () => {
    await updateNotificationsAction(undefined, form({ budget_alerts: "on", product: "on", security: "off" }));
    expect(updates[0].payload.notification_prefs).toEqual({ budget_alerts: true, bill_reminders: false, subscription_reminders: false, goal_updates: false, product: true });
  });
});

describe("email change verification", () => {
  it("asks Supabase to send a confirmation link and does not claim the address changed", async () => {
    const r = await requestEmailChangeAction(undefined, form({ email: "New.Address@Example.test", password: PW }));
    expect(updateUser).toHaveBeenCalledWith({ email: "new.address@example.test" }, { emailRedirectTo: "http://127.0.0.1:3100/auth/confirm?next=/app/settings" });
    expect(r.notice).toMatch(/stays asha@example.test until you open it/);
  });
  it("a password account must give the right password first", async () => {
    verifyPassword.mockResolvedValueOnce(false);
    const r = await requestEmailChangeAction(undefined, form({ email: "new@example.test", password: "wrong" }));
    expect(r.fieldErrors?.password).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("rejects a malformed address and the current address", async () => {
    expect((await requestEmailChangeAction(undefined, form({ email: "nope" }))).fieldErrors?.email).toBeTruthy();
    expect((await requestEmailChangeAction(undefined, form({ email: "ASHA@example.test", password: PW }))).fieldErrors?.email).toMatch(/already/);
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("an account without a password needs a recent sign-in", async () => {
    user = { ...user, identities: [{ provider: "google" }], last_sign_in_at: new Date(Date.now() - 3_600_000).toISOString() };
    const r = await requestEmailChangeAction(undefined, form({ email: "new@example.test" }));
    expect(r.needsReauth).toBe(true);
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("surfaces rate limiting without revealing whether the address exists", async () => {
    updateUser.mockResolvedValueOnce({ error: { status: 429, code: "over_email_send_rate_limit", message: "rate" } });
    expect((await requestEmailChangeAction(undefined, form({ email: "new@example.test", password: PW }))).error).toMatch(/Too many/);
  });
});

describe("password change", () => {
  it("needs the current password, enforces strength, and signs out other devices on success", async () => {
    verifyPassword.mockResolvedValueOnce(false);
    expect((await changePasswordAction(undefined, form({ current: "bad", password: PW, confirm: PW }))).fieldErrors?.current).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
    expect((await changePasswordAction(undefined, form({ current: "old", password: "short", confirm: "short" }))).fieldErrors?.password).toBeTruthy();
    expect((await changePasswordAction(undefined, form({ current: "old", password: PW, confirm: "different" }))).fieldErrors?.confirm).toBeTruthy();
    const ok = await changePasswordAction(undefined, form({ current: "old-password-1!", password: PW, confirm: PW }));
    expect(ok.notice).toMatch(/Password updated/);
    expect(updateUser).toHaveBeenCalledWith({ password: PW });
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
  });
  it("never echoes passwords back", async () => {
    const r = await changePasswordAction(undefined, form({ current: "old", password: "short", confirm: "short" }));
    expect(JSON.stringify(r)).not.toContain("short\"");
  });
});

describe("connected provider management", () => {
  it("refuses to disconnect the only sign-in method", async () => {
    identities = [{ provider: "google", identity_id: "g1" }];
    const r = await unlinkProviderAction(undefined, form({ provider: "google" }));
    expect(r.error).toMatch(/only way to sign in/);
    expect(unlinkIdentity).not.toHaveBeenCalled();
  });
  it("disconnects one of several", async () => {
    identities = [{ provider: "email", identity_id: "e1" }, { provider: "github", identity_id: "h1" }];
    const r = await unlinkProviderAction(undefined, form({ provider: "github" }));
    expect(r.notice).toBe("Disconnected.");
    expect(unlinkIdentity).toHaveBeenCalledWith({ provider: "github", identity_id: "h1" });
  });
  it("cannot disconnect something that is not connected", async () => {
    identities = [{ provider: "email", identity_id: "e1" }, { provider: "github", identity_id: "h1" }];
    expect((await unlinkProviderAction(undefined, form({ provider: "google" }))).error).toMatch(/not connected/);
    expect(unlinkIdentity).not.toHaveBeenCalled();
  });
});

describe("account deletion safeguards", () => {
  const ok = { confirm: "DELETE", password: PW };

  it("requires the exact confirmation word", async () => {
    const r = await deleteAccountAction(undefined, form({ confirm: "delete", password: PW }));
    expect(r.fieldErrors?.confirm).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("requires re-authentication: a wrong password deletes nothing", async () => {
    verifyPassword.mockResolvedValueOnce(false);
    const r = await deleteAccountAction(undefined, form({ ...ok, password: "wrong" }));
    expect(r.fieldErrors?.password).toBeTruthy();
    expect(calls).toEqual([]);
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("an account without a password must have signed in recently", async () => {
    user = { ...user, identities: [{ provider: "github" }], last_sign_in_at: new Date(Date.now() - 3_600_000).toISOString() };
    const r = await deleteAccountAction(undefined, form({ confirm: "DELETE" }));
    expect(r.needsReauth).toBe(true);
    expect(calls).toEqual([]);
  });

  it("refuses while the person owns a shared space, names it, and removes nothing", async () => {
    rpcResults.deletion_blockers = { data: [{ space_id: "s9", space_name: "Family budget", other_members: 2 }], error: null };
    const r = await deleteAccountAction(undefined, form(ok));
    expect(r.error).toMatch(/Family budget/);
    expect(r.error).toMatch(/Nothing was deleted/);
    expect(storageRemove).not.toHaveBeenCalled();
    expect(calls).toEqual(["rpc:deletion_blockers"]);
  });

  it("if stored files cannot be removed, the database rows are not touched", async () => {
    storageRemove.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const r = await deleteAccountAction(undefined, form(ok));
    expect(r.error).toMatch(/nothing was deleted/i);
    expect(calls).not.toContain("rpc:delete_my_data");
  });

  it("deletes files first, then data, then signs out, leaving the sign-in identity alone by default", async () => {
    await expect(deleteAccountAction(undefined, form(ok))).rejects.toThrow("REDIRECT:/login?deleted=data");
    const order = calls.filter((c) => c.startsWith("storage.remove") || c === "rpc:delete_my_data");
    expect(order[0]).toMatch(/^storage\.remove/);
    expect(order[order.length - 1]).toBe("rpc:delete_my_data");
    expect(signOut).toHaveBeenCalled();
    expect(adminDelete).not.toHaveBeenCalled();
  });

  it("removes the sign-in identity only when explicitly enabled and a service role is configured", async () => {
    deleteAuthFlag = true;
    await expect(deleteAccountAction(undefined, form(ok))).rejects.toThrow("REDIRECT:/login?deleted=data");
    expect(adminDelete).not.toHaveBeenCalled(); // flag on, but no service key: the identity is not touched and the outcome says so
    adminEnabled = true;
    await expect(deleteAccountAction(undefined, form(ok))).rejects.toThrow("REDIRECT:/login?deleted=1");
    expect(adminDelete).toHaveBeenCalledWith("u1");
  });

  it("reports honestly when the identity could not be removed", async () => {
    deleteAuthFlag = true;
    adminEnabled = true;
    adminDelete.mockResolvedValueOnce({ error: { message: "fk violation" } });
    await expect(deleteAccountAction(undefined, form(ok))).rejects.toThrow("REDIRECT:/login?deleted=data");
  });

  it("a database failure leaves the person signed in and tells them nothing changed", async () => {
    rpcResults.delete_my_data = { data: null, error: { message: "something" } };
    const r = await deleteAccountAction(undefined, form(ok));
    expect(r.error).toMatch(/Nothing was changed/);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("says so when the server has not been updated", async () => {
    rpcResults.deletion_blockers = { data: null, error: { message: "Could not find the function budgetbuddy.deletion_blockers in the schema cache" } };
    const r = await deleteAccountAction(undefined, form(ok));
    expect(r.error).toMatch(/not available on this server yet/);
    expect(calls).toEqual(["rpc:deletion_blockers"]);
  });
});
