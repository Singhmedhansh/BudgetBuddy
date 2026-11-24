import type { RecurringPreset } from "./planning-forms";

export type RecurringKind = "bill" | "subscription" | "income";

export interface Starter extends RecurringPreset {
  name: string;
  /** One line under the name on the card. */
  note: string;
}

/** One-tap starting points for an empty list. Each opens the add form with these values filled in, to check and save. */
export const STARTERS: Record<RecurringKind, Starter[]> = {
  income: [
    { name: "Salary", frequency: "monthly", category: "Salary", note: "Your monthly pay" },
    { name: "Freelance work", frequency: "monthly", category: "Freelance", note: "Retainers and client payments" },
    { name: "Allowance", frequency: "monthly", category: "Allowance", note: "Pocket money or a stipend" },
    { name: "Interest", frequency: "quarterly", category: "Interest", note: "Savings and FD interest" },
  ],
  bill: [
    { name: "Rent", frequency: "monthly", category: "Rent", note: "Due every month" },
    { name: "Electricity", frequency: "monthly", category: "Utilities", note: "Power and water" },
    { name: "Mobile and internet", frequency: "monthly", category: "Utilities", note: "Phone and broadband" },
    { name: "Insurance premium", frequency: "yearly", category: "Health", note: "Health, life or vehicle" },
  ],
  subscription: [
    { name: "Netflix", frequency: "monthly", category: "Subscriptions", note: "Streaming" },
    { name: "Spotify", frequency: "monthly", category: "Subscriptions", note: "Music" },
    { name: "YouTube Premium", frequency: "monthly", category: "Subscriptions", note: "Video without ads" },
    { name: "Cloud storage", frequency: "monthly", category: "Subscriptions", note: "iCloud, Google One and others" },
  ],
};

const FREQUENCIES = new Set(["once", "weekly", "monthly", "quarterly", "yearly"]);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** Reads a starter from the add page's address. Anything unexpected is dropped, never shown as typed. */
export function readPreset(sp: Record<string, string | string[] | undefined>): RecurringPreset | undefined {
  const name = one(sp.name)?.slice(0, 60);
  const frequency = one(sp.frequency);
  const category = one(sp.category)?.slice(0, 40);
  if (!name && !frequency && !category) return undefined;
  return { name, frequency: frequency && FREQUENCIES.has(frequency) ? (frequency as RecurringPreset["frequency"]) : undefined, category };
}

/** The add-form address for a starter card. */
export function starterHref(base: string, s: Starter): string {
  const q = new URLSearchParams({ name: s.name, ...(s.frequency ? { frequency: s.frequency } : {}), ...(s.category ? { category: s.category } : {}) });
  return `${base}/new?${q}`;
}
