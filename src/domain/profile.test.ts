import { describe, expect, it } from "vitest";
import {
  BANNER_SNOOZE_DAYS,
  canUnlink,
  normalizeDashboardPrefs,
  normalizeNotificationPrefs,
  normalizePhone,
  PHONE_RE,
  profileCompletion,
  showProfileBanner,
} from "./profile";

const full = { display_name: "Asha Rao", country: "IN", persona: "professional", date_format: "dmy" };

describe("profile completion percentage", () => {
  it("is 0% and pending for a brand-new profile", () => {
    const c = profileCompletion({});
    expect(c).toMatchObject({ percent: 0, status: "pending" });
    expect(c.missing.map((m) => m.key)).toEqual(["name", "country", "persona", "date_format"]);
  });

  it("counts each required field once and reports exactly what is missing (partial profile)", () => {
    expect(profileCompletion({ display_name: "Asha" })).toMatchObject({ percent: 25, status: "pending" });
    const half = profileCompletion({ display_name: "Asha", country: "IN" });
    expect(half.percent).toBe(50);
    expect(half.missing.map((m) => m.key)).toEqual(["persona", "date_format"]);
    expect(profileCompletion({ ...full, date_format: null })).toMatchObject({ percent: 75, status: "pending" });
  });

  it("stays pending until every required field is filled, then is complete at 100%", () => {
    expect(profileCompletion(full)).toMatchObject({ percent: 100, status: "complete", missing: [] });
  });

  it("treats blank and whitespace-only values as missing", () => {
    expect(profileCompletion({ ...full, display_name: "   " }).missing.map((m) => m.key)).toEqual(["name"]);
    expect(profileCompletion({ ...full, country: "" }).status).toBe("pending");
  });

  it("optional details are suggestions only: they neither inflate nor block completion", () => {
    expect(profileCompletion(full).optionalMissing.map((m) => m.key)).toEqual(["avatar", "phone"]);
    expect(profileCompletion({ ...full, phone: "+91 98765 43210", avatar_path: "u/a.png" })).toMatchObject({ percent: 100, status: "complete", optionalMissing: [] });
    expect(profileCompletion({ phone: "+91 98765 43210", avatar_path: "u/a.png" })).toMatchObject({ percent: 0, status: "pending" });
  });

  it("a stored completed_at stamp does not make an incomplete profile complete", () => {
    expect(profileCompletion({ ...full, country: null, profile_completed_at: "2026-01-01T00:00:00Z" }).status).toBe("pending");
  });
});

describe("profile banner", () => {
  const now = new Date("2026-11-13T10:00:00Z");
  it("shows while pending", () => {
    expect(showProfileBanner({ display_name: "Asha" }, now)).toBe(true);
  });
  it("dismissing hides it only for a while and never completes the profile", () => {
    const dismissed = { display_name: "Asha", banner_dismissed_until: new Date(now.getTime() + BANNER_SNOOZE_DAYS * 864e5).toISOString() };
    expect(showProfileBanner(dismissed, now)).toBe(false);
    expect(profileCompletion(dismissed).status).toBe("pending");
    // back after the snooze ends
    expect(showProfileBanner(dismissed, new Date(now.getTime() + (BANNER_SNOOZE_DAYS + 1) * 864e5))).toBe(true);
  });
  it("disappears once everything required is filled, dismissed or not", () => {
    expect(showProfileBanner(full, now)).toBe(false);
  });
});

describe("phone numbers", () => {
  it.each(["+91 98765 43210", "9876543210", "+1 (415) 555-0100", "020 7946 0958"])("accepts %s", (v) => expect(PHONE_RE.test(normalizePhone(v))).toBe(true));
  it.each(["call me", "12", "+", "123-abc-4567", "1".repeat(30)])("rejects %s", (v) => expect(PHONE_RE.test(normalizePhone(v))).toBe(false));
  it("collapses stray whitespace", () => expect(normalizePhone("  +91   98765  43210 ")).toBe("+91 98765 43210"));
});

describe("notification preferences", () => {
  it("fills defaults for a new user: alerts on, product announcements off", () => {
    expect(normalizeNotificationPrefs({})).toEqual({ budget_alerts: true, bill_reminders: true, subscription_reminders: true, goal_updates: true, product: false });
  });
  it("keeps explicit choices and ignores unknown keys and non-booleans", () => {
    expect(normalizeNotificationPrefs({ budget_alerts: false, product: true, hax: true, bill_reminders: "yes" })).toEqual({
      budget_alerts: false, bill_reminders: true, subscription_reminders: true, goal_updates: true, product: true,
    });
  });
  it("survives garbage", () => {
    for (const bad of [null, undefined, 5, "x", [1, 2]]) expect(normalizeNotificationPrefs(bad).budget_alerts).toBe(true);
  });
});

describe("dashboard preferences", () => {
  it("shows every section by default and honours opt-outs", () => {
    expect(Object.values(normalizeDashboardPrefs({})).every(Boolean)).toBe(true);
    expect(normalizeDashboardPrefs({ trend: false })).toMatchObject({ trend: false, recent: true });
    expect(normalizeDashboardPrefs("nope").trend).toBe(true);
  });
});

describe("connected providers", () => {
  it("never allows removing the only sign-in method", () => {
    expect(canUnlink([{ provider: "google" }], "google")).toEqual({ ok: false, reason: expect.stringContaining("only way") });
    expect(canUnlink([{ provider: "email" }], "email").ok).toBe(false);
  });
  it("allows removing one of several", () => {
    expect(canUnlink([{ provider: "email" }, { provider: "github" }], "github").ok).toBe(true);
    expect(canUnlink([{ provider: "google" }, { provider: "github" }], "google").ok).toBe(true);
  });
  it("refuses a method that is not connected", () => {
    expect(canUnlink([{ provider: "email" }, { provider: "google" }], "github").ok).toBe(false);
  });
});
