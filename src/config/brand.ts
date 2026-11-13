/**
 * The product's public identity, in one place. Display text only: internal identifiers (the `budgetbuddy`
 * database schema, storage buckets, the auth cookie name, export and env-var names) are deliberately
 * unchanged so a rename never needs a migration or signs anyone out.
 */
export const BRAND = {
  name: "FinTrack",
  tagline: "Your finances. In focus.",
  description: "Track expenses, plan budgets, manage subscriptions and understand your finances in one place.",
  supportAnchor: "FinTrack support",
} as const;
