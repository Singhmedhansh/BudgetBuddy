import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

const EMAIL = process.env.E2E_USER_EMAIL!;
const PASSWORD = process.env.E2E_USER_PASSWORD!;

/** Collect console errors and failed requests so a broken asset or script fails the test. */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  // ERR_ABORTED is the browser cancelling a request that a redirect or navigation replaced; not a broken asset.
  page.on("requestfailed", (r) => {
    if (r.failure()?.errorText !== "net::ERR_ABORTED") problems.push(`failed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/auth/v1/")) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  return problems;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await expect(page).toHaveURL(/\/app/);
}

test.describe.serial("hosted preview", () => {
  test("landing page: branding, pricing, no old name, clean console", async ({ page }) => {
    const problems = watch(page);
    await page.goto("/");
    await expect(page).toHaveTitle(/FinTrack: Your finances\. In focus\./);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your finances. In focus.");
    const pricing = page.locator("#pricing");
    await expect(pricing).toContainText("FinTrack Free");
    await expect(pricing).toContainText("FinTrack One");
    await expect(pricing).toContainText("₹149");
    await expect(pricing).toContainText("₹1,199");
    await expect(page.locator("body")).not.toContainText(/budget[\s-]buddy/i);
    await expect(page.getByRole("link", { name: /FinTrack home/ }).first()).toBeVisible();
    for (const path of ["/icon.svg", "/manifest.webmanifest", "/opengraph-image", "/apple-icon"]) {
      const r = await page.request.get(path);
      expect(r.ok(), path).toBe(true);
    }
    expect(problems).toEqual([]);
  });

  test("auth pages render, hide unconfigured providers, and security headers are present", async ({ page }) => {
    for (const path of ["/login", "/signup", "/forgot-password"]) {
      const res = await page.goto(path);
      expect(res!.status()).toBe(200);
      await expect(page.getByRole("link", { name: "FinTrack home" })).toBeVisible();
      if (path !== "/forgot-password") await expect(page.getByRole("button", { name: /with (Google|GitHub)/ })).toHaveCount(0);
    }
    const h = (await page.request.get("/")).headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["strict-transport-security"]).toContain("max-age");
  });

  test("a signed-out visitor is sent to log in, and a wrong password is refused", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password", { exact: true }).fill("Definitely-Wrong-1!");
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("log in, dashboard and navigation, light and dark themes", async ({ page }) => {
    const problems = watch(page);
    await login(page);
    await expect(page.getByRole("link", { name: "FinTrack dashboard" })).toBeVisible();
    for (const [name, url] of [["Transactions", /transactions/], ["Accounts", /accounts/], ["Budgets", /budgets/], ["Analytics", /analytics/]] as const) {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
    await page.getByRole("radiogroup", { name: "Colour theme" }).getByRole("radio", { name: /dark/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radiogroup", { name: "Colour theme" }).getByRole("radio", { name: /light/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(problems).toEqual([]);
  });

  test("a financial operation: add an account and an expense, and the balance follows", async ({ page }) => {
    await login(page);
    const name = `Smoke Cash ${Date.now().toString(36)}`;
    await page.goto("/app/accounts/new");
    await page.getByLabel("Account name").fill(name);
    await page.getByRole("combobox", { name: "Account type" }).click();
    await page.getByRole("listbox").locator('[role=option][data-value="cash"]').click();
    await page.getByLabel(/Current balance/).fill("1000");
    await page.getByRole("button", { name: "Add account" }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    await page.goto("/app/transactions/new");
    await page.getByLabel("Amount").fill("250");
    await page.getByRole("combobox", { name: /^Account$/ }).click();
    await page.getByRole("listbox").getByRole("option", { name, exact: true }).click();
    await page.getByRole("combobox", { name: "Category" }).click();
    await page.getByRole("listbox").getByRole("option").first().click();
    await page.getByRole("button", { name: /save|add transaction/i }).first().click();
    await expect(page).toHaveURL(/\/app\/transactions/);
    await page.goto("/app/accounts");
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.locator("body")).toContainText("750");
  });

  test("dropdowns and the calendar work on the hosted site", async ({ page }) => {
    const problems = watch(page);
    await login(page);
    await page.goto("/app/subscriptions/new");
    await page.getByRole("combobox", { name: "How often" }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^First due date/ }).click();
    const dialog = page.getByRole("dialog", { name: "Choose a date" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Next month" }).click();
    await dialog.locator("[data-iso]").nth(15).click();
    await expect(dialog).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("photo upload shows the migration-related message, not a connection error", async ({ page }) => {
    await login(page);
    await page.goto("/app/settings");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.locator('input[type=file]').setInputFiles({ name: "p.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText(/Photo storage has not been set up|database update/i)).toBeVisible();
  });
});
