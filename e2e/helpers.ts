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

/**
 * Choose an option in a FinTrack select (a listbox popover, not a native <select>).
 * `option` is a value (string), `{ label }` for the visible text, or `{ index }` for the nth option.
 */
export async function choose(page: Page, label: string | RegExp, option: string | { label: string | RegExp } | { index: number }) {
  await page.getByRole("combobox", { name: label }).click();
  const list = page.getByRole("listbox");
  if (typeof option === "string") await list.locator(`[role=option][data-value="${option}"]`).click();
  else if ("label" in option) await list.getByRole("option", { name: option.label, exact: typeof option.label === "string" }).click();
  else await list.getByRole("option").nth(option.index).click();
}

/** Choose a date (YYYY-MM-DD) in a FinTrack date field by using its calendar, as a person would. */
export async function pickDate(page: Page, label: string | RegExp, isoDate: string) {
  await page.getByRole("button", { name: label }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a date" });
  const cell = dialog.locator(`[data-iso="${isoDate}"]`);
  const months = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  for (let i = 0; i < 36 && !(await cell.count()); i++) {
    const shown = await dialog.locator("[data-iso]").first().getAttribute("data-iso");
    const mid = await dialog.locator("[data-iso]").nth(20).getAttribute("data-iso");
    await dialog.getByRole("button", { name: months(isoDate) < months(mid ?? shown!) ? "Previous month" : "Next month" }).click();
  }
  await cell.click();
}
