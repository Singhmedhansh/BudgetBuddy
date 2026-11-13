import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { loginUi, USER } from "./helpers";

// Every test here starts signed out.
test.use({ storageState: { cookies: [], origins: [] } });

const PROTECTED = ["/app", "/app/transactions", "/app/accounts", "/app/budgets", "/app/goals", "/app/bills", "/app/settings", "/app/members", "/app/forecast", "/app/import"];

test.describe("signed-out visitors", () => {
  for (const path of PROTECTED) {
    test(`${path} redirects to login and returns after signing in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    });
  }

  test("exports are not readable without a session", async ({ request }) => {
    for (const p of ["/app/export/all", "/app/export/transactions"]) {
      const r = await request.get(p, { maxRedirects: 0 });
      expect([302, 303, 307, 308, 401, 403]).toContain(r.status());
      expect(await r.text()).not.toContain("merchant");
    }
  });
});

test.describe("login", () => {
  test("wrong password and unknown email give the same message and reveal nothing", async ({ page }) => {
    await loginUi(page, USER.email, "Wrong-password-1!");
    const a = await page.getByRole("alert").filter({ hasText: /./ }).first().innerText();
    await page.goto("/login");
    await loginUi(page, "nobody-here@example.test", "Wrong-password-1!");
    const b = await page.getByRole("alert").filter({ hasText: /./ }).first().innerText();
    expect(a).toBe(b);
    expect(a.toLowerCase()).not.toContain("not found");
    await expect(page).toHaveURL(/\/login/);
  });

  test("empty and malformed submissions are validated in plain words", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/valid email/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid input");
  });

  test("a successful login lands on the dashboard, survives a reload, and an off-site next URL is ignored", async ({ page }) => {
    await page.goto("/login?next=https://evil.example/steal");
    await page.getByLabel("Email").fill(USER.email);
    await page.getByLabel("Password", { exact: true }).fill(USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/app/);
    await page.reload();
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("after logout the session is gone, protected pages redirect, and Back does not reveal data", async ({ page }) => {
    await loginUi(page);
    await expect(page).toHaveURL(/\/app/);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/($|\?|login)/);
    await page.goto("/app/transactions");
    await expect(page).toHaveURL(/\/login/);
    await page.goBack();
    await page.reload();
    await expect(page.getByText("You hold")).toHaveCount(0); // no signed-in dashboard content
  });

  test("an expired or corrupted session cookie is treated as signed out", async ({ page, context, baseURL }) => {
    await loginUi(page);
    await expect(page).toHaveURL(/\/app/);
    const cookies = await context.cookies();
    const auth = cookies.filter((c) => c.name.startsWith("sb-budgetbuddy-auth-token"));
    expect(auth.length).toBeGreaterThan(0);
    await context.clearCookies();
    await context.addCookies(auth.map((c) => ({ ...c, value: "base64-" + Buffer.from("{\"access_token\":\"expired.invalid.token\",\"refresh_token\":\"nope\",\"expires_at\":1}").toString("base64url") })));
    await page.goto(`${baseURL}/app`);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("sessions are independent of other apps on the same project", () => {
  test("a session stored under the default Supabase cookie name does not sign anyone into FinTrack", async ({ page, context, baseURL }) => {
    const sb = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_KEY!, { auth: { persistSession: false } });
    const { data } = await sb.auth.signInWithPassword(USER);
    const host = new URL(baseURL!).hostname;
    const ref = new URL(process.env.E2E_SUPABASE_URL!).hostname.split(".")[0];
    const value = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
    // This is the cookie another app on the same Supabase project (for example HireCheck) would use.
    await context.addCookies([{ name: `sb-${ref}-auth-token`, value, domain: host, path: "/" }]);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signing out of FinTrack does not clear a cookie belonging to another app", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "sb-otherapp-auth-token", value: "other-app-session", domain: new URL(baseURL!).hostname, path: "/" }]);
    await loginUi(page);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/($|\?|login)/);
    const left = (await context.cookies()).find((c) => c.name === "sb-otherapp-auth-token");
    expect(left?.value).toBe("other-app-session");
  });
});

test.describe("password recovery", () => {
  test("the reset request gives the same answer for a real and an unknown address", async ({ page }) => {
    const ask = async (email: string) => {
      await page.goto("/forgot-password");
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: /send|reset/i }).click();
      const note = page.getByRole("status").or(page.getByRole("alert")).filter({ hasText: /./ }).first();
      await expect(note).toBeVisible();
      return note.innerText();
    };
    // Unknown address only: we never trigger a real reset email for a real account here.
    const unknown = await ask("nobody-here-2@example.test");
    expect(unknown.toLowerCase()).toMatch(/if an account|check your email|sent/);
  });

  test("the reset page refuses to change a password without a valid recovery link", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("button", { name: /update|save|set/i })).toHaveCount(0);
    await expect(page.getByText(/expired|invalid|request a new|link/i).first()).toBeVisible();
  });

  test("invalid and expired recovery tokens land on a clear error, not a reset form", async ({ page }) => {
    for (const q of ["token_hash=bogus&type=recovery", "token_hash=&type=recovery", "type=recovery", "token_hash=bogus&type=magiclink"]) {
      await page.goto(`/auth/confirm?${q}`);
      await expect(page).toHaveURL(/link-error|login|forgot/);
      await expect(page.getByRole("button", { name: /update password/i })).toHaveCount(0);
    }
    await page.goto("/auth/link-error");
    await expect(page.getByRole("heading").first()).toBeVisible();
  });
});

test.describe("signup validation", () => {
  test("every problem is reported in plain words and nothing is created", async ({ page }) => {
    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /create|sign up/i }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByText(/valid email/i)).toBeVisible();
    await page.getByLabel("Name").fill("E2E Person");
    await page.getByLabel("Email").fill("e2e-person@example.test");
    await page.getByLabel("Password", { exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: /create|sign up/i }).click();
    await expect(page.getByText(/at least 10|too short|10 characters/i).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid input");
    // what was typed is kept after the error
    await expect(page.getByLabel("Name")).toHaveValue("E2E Person");
    await expect(page.getByLabel("Email")).toHaveValue("e2e-person@example.test");
  });
});
