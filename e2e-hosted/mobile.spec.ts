import { expect, test, type Page } from "@playwright/test";

const noOverflow = async (page: Page, path: string) => {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${path} scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
};

test("public pages fit a phone screen", async ({ page }) => {
  for (const p of ["/", "/login", "/signup", "/help", "/security"]) await noOverflow(page, p);
});

test("signed-in pages fit a phone screen and the menu opens", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_USER_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_USER_PASSWORD!);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await expect(page).toHaveURL(/\/app/);
  for (const p of ["/app", "/app/transactions", "/app/accounts/new", "/app/subscriptions/new", "/app/settings"]) await noOverflow(page, p);
  await page.goto("/app/subscriptions/new");
  await page.getByRole("button", { name: /^First due date/ }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a date" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
