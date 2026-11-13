import { COUNTRIES, DATE_FORMATS, NUMBER_FORMATS } from "@/config/profile-options";

/** The slice of a profile that completion and preferences are computed from. Missing columns read as empty. */
export interface ProfileFields {
  display_name?: string | null;
  country?: string | null;
  persona?: string | null;
  date_format?: string | null;
  phone?: string | null;
  avatar_path?: string | null;
  profile_completed_at?: string | null;
  banner_dismissed_until?: string | null;
}

export type RequiredField = "name" | "country" | "persona" | "date_format";
const REQUIRED: { key: RequiredField; label: string; read: (p: ProfileFields) => unknown }[] = [
  { key: "name", label: "Full name", read: (p) => p.display_name },
  { key: "country", label: "Country", read: (p) => p.country },
  { key: "persona", label: "How you will use FinTrack", read: (p) => p.persona },
  { key: "date_format", label: "Date format", read: (p) => p.date_format },
];
const OPTIONAL: { key: "avatar" | "phone"; label: string; read: (p: ProfileFields) => unknown }[] = [
  { key: "avatar", label: "Profile photo", read: (p) => p.avatar_path },
  { key: "phone", label: "Phone number", read: (p) => p.phone },
];

const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export interface Completion {
  /** 0 to 100, over the required fields only. Optional details never inflate or block it. */
  percent: number;
  /** "complete" only when every required field is filled. A dismissed banner never changes this. */
  status: "pending" | "complete";
  missing: { key: RequiredField; label: string }[];
  optionalMissing: { key: "avatar" | "phone"; label: string }[];
}

export function profileCompletion(p: ProfileFields): Completion {
  const missing = REQUIRED.filter((f) => !filled(f.read(p))).map(({ key, label }) => ({ key, label }));
  const done = REQUIRED.length - missing.length;
  return {
    percent: Math.round((done / REQUIRED.length) * 100),
    status: missing.length === 0 ? "complete" : "pending",
    missing,
    optionalMissing: OPTIONAL.filter((f) => !filled(f.read(p))).map(({ key, label }) => ({ key, label })),
  };
}

/** The banner shows while the profile is pending and it has not been dismissed for now. Dismissal only hides it for a while. */
export function showProfileBanner(p: ProfileFields, now: Date): boolean {
  if (profileCompletion(p).status === "complete") return false;
  const until = p.banner_dismissed_until ? new Date(p.banner_dismissed_until).getTime() : 0;
  return !(until > now.getTime());
}
export const BANNER_SNOOZE_DAYS = 3;

// ───────── validators shared by the forms and the server actions ─────────
export const isCountry = (v: string) => COUNTRIES.some((c) => c.code === v);
export const isDateFormat = (v: string) => DATE_FORMATS.some((d) => d.value === v);
export const isNumberFormat = (v: string) => NUMBER_FORMATS.some((n) => n.value === v);
export const PHONE_RE = /^\+?[0-9][0-9 ()-]{5,18}[0-9]$/;
export const normalizePhone = (v: string) => v.trim().replace(/\s+/g, " ");

// ───────── notification preferences ─────────
export const NOTIFICATION_KEYS = [
  { key: "budget_alerts", label: "Budget alerts", hint: "When a budget reaches its warning level or is exceeded.", default: true },
  { key: "bill_reminders", label: "Bill reminders", hint: "Before a bill is due.", default: true },
  { key: "subscription_reminders", label: "Subscription reminders", hint: "Before a subscription renews.", default: true },
  { key: "goal_updates", label: "Savings goal updates", hint: "When a goal reaches a milestone.", default: true },
  { key: "product", label: "Product announcements", hint: "What is new in FinTrack. Occasional.", default: false },
] as const;
export type NotificationKey = (typeof NOTIFICATION_KEYS)[number]["key"];

/** Reads stored preferences, filling defaults and ignoring anything unknown or not a boolean. */
export function normalizeNotificationPrefs(raw: unknown): Record<NotificationKey, boolean> {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(NOTIFICATION_KEYS.map((k) => [k.key, typeof src[k.key] === "boolean" ? src[k.key] : k.default])) as Record<NotificationKey, boolean>;
}

// ───────── dashboard preferences ─────────
export const DASHBOARD_SECTIONS = [
  { key: "trend", label: "Income and spending trend" },
  { key: "categories", label: "Where the money went" },
  { key: "budgets", label: "Budgets needing attention" },
  { key: "recent", label: "Recent transactions" },
] as const;
export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number]["key"];

export function normalizeDashboardPrefs(raw: unknown): Record<DashboardSection, boolean> {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(DASHBOARD_SECTIONS.map((s) => [s.key, typeof src[s.key] === "boolean" ? src[s.key] : true])) as Record<DashboardSection, boolean>;
}

// ───────── connected sign-in methods ─────────
export interface IdentityLike {
  provider: string;
  identity_id?: string;
}

/** A sign-in method can be removed only when another one remains, so nobody can lock themselves out. */
export function canUnlink(identities: IdentityLike[], providerToRemove: string): { ok: boolean; reason?: string } {
  const target = identities.find((i) => i.provider === providerToRemove);
  if (!target) return { ok: false, reason: "That sign-in method is not connected." };
  if (identities.length <= 1) return { ok: false, reason: "This is your only way to sign in. Connect another method first." };
  return { ok: true };
}
