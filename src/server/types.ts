/** Row shapes for the `budgetbuddy` schema (kept in step with the migrations). */
export type SpaceRole = "owner" | "admin" | "editor" | "viewer";
export type AccountType =
  | "savings" | "current" | "cash" | "credit_card" | "wallet" | "investment" | "other_asset" | "other_liability";

export interface Profile {
  user_id: string;
  display_name: string | null;
  persona: "student" | "professional" | "household" | "other" | null;
  currency: string;
  timezone: string;
  theme: "light" | "dark" | "system";
  onboarding_completed_at: string | null;
  onboarding_state: { accountSkipped?: boolean };
}

export interface Space {
  id: string;
  name: string;
  kind: string;
  currency: string;
}

export interface Account {
  id: string;
  space_id: string;
  name: string;
  type: AccountType;
  currency: string;
  archived_at: string | null;
  is_manual: boolean;
}

export interface Category {
  id: string;
  space_id: string;
  name: string;
  kind: "expense" | "income" | "equity";
  archived_at: string | null;
}

export interface TransactionRow {
  id: string;
  type: "expense" | "income" | "transfer" | "refund" | "adjustment";
  status: "posted" | "pending" | "reversed";
  occurred_at: string;
  currency: string;
  amount: number;
  merchant: string | null;
  description: string | null;
  reversal_of: string | null;
  source: "manual" | "import" | "integration";
}

export const LIABILITY_TYPES: AccountType[] = ["credit_card", "other_liability"];
export const isLiability = (t: AccountType) => LIABILITY_TYPES.includes(t);

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  savings: "Savings account",
  current: "Current account",
  cash: "Cash",
  credit_card: "Credit card",
  wallet: "Digital wallet",
  investment: "Investment (tracking only)",
  other_asset: "Other asset",
  other_liability: "Other liability",
};
