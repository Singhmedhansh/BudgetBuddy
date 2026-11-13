import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

export const USER = { email: process.env.E2E_USER_EMAIL!, password: process.env.E2E_USER_PASSWORD! };

/** A supabase-js client signed in as the test user, reading the same ledger the app does. */
export async function api() {
  const sb = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_KEY!, { auth: { persistSession: false }, db: { schema: "budgetbuddy" } });
  const { error } = await sb.auth.signInWithPassword(USER);
  if (error) throw new Error("E2E sign-in failed: " + error.message);
  return sb;
}

export async function loginUi(page: Page, email = USER.email, password = USER.password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
}

export const unique = (p: string) => `${p} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

/** Parse "₹1,23,456.70" / "-₹380.00" into minor units. */
export function minor(text: string): number {
  const neg = /-/.test(text.replace(/[^\d.\-+]/g, "").charAt(0)) || /^\s*-/.test(text);
  const n = Math.round(parseFloat(text.replace(/[^\d.]/g, "")) * 100);
  return neg ? -n : n;
}
