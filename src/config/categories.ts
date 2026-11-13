/**
 * Starter categories by profile. Personalisation only changes what is suggested
 * during setup; every category can be added, renamed or archived later and no
 * feature is tied to a profile.
 */
export type Persona = "student" | "professional" | "household" | "other";

const INCOME = ["Salary", "Allowance", "Freelance", "Interest", "Other income"];

const EXPENSE: Record<Persona, string[]> = {
  student: ["Food", "Transport", "College", "Shopping", "Entertainment", "Subscriptions", "Health"],
  professional: ["Rent", "Groceries", "Dining", "Transport", "EMI and loans", "Subscriptions", "Utilities", "Shopping", "Health"],
  household: ["Groceries", "Rent", "Utilities", "Household", "Kids", "Healthcare", "Transport", "Dining", "Subscriptions"],
  other: ["Food", "Housing", "Transport", "Utilities", "Shopping", "Health", "Entertainment", "Subscriptions"],
};

export function starterCategories(persona: Persona): { name: string; kind: "expense" | "income" }[] {
  return [
    ...EXPENSE[persona].map((name) => ({ name, kind: "expense" as const })),
    ...INCOME.map((name) => ({ name, kind: "income" as const })),
  ];
}

export const COMMON_TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Berlin",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC",
];

export const CURRENCIES = [
  { code: "INR", label: "Indian rupee (INR)" },
  { code: "USD", label: "US dollar (USD)" },
  { code: "EUR", label: "Euro (EUR)" },
  { code: "GBP", label: "Pound sterling (GBP)" },
  { code: "AED", label: "UAE dirham (AED)" },
  { code: "SGD", label: "Singapore dollar (SGD)" },
  { code: "AUD", label: "Australian dollar (AUD)" },
  { code: "CAD", label: "Canadian dollar (CAD)" },
];
