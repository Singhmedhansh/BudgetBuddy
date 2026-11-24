/**
 * The product's public identity, in one place. Display text only: internal identifiers (the `budgetbuddy`
 * database schema, storage buckets, the auth cookie name, export and env-var names) are deliberately
 * unchanged so a rename never needs a migration or signs anyone out.
 */
export const BRAND = {
  name: "FinTrack",
  tagline: "Meet Finn. Your money, handled.",
  description: "Finn, your money assistant: tell it what you spent, ask it anything about your money, and plan with your own numbers. Budgets, bills and goals in one place.",
  /** The assistant's name, shown on the Assistant page and in the chat. */
  assistantName: "Finn",
  supportAnchor: "FinTrack support",
} as const;
