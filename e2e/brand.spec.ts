import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const PUBLIC = ["/", "/login", "/signup", "/forgot-password", "/help", "/contact", "/security", "/legal/privacy", "/legal/terms", "/legal/billing", "/legal/disclaimer", "/legal/cookies"];

test.describe("FinTrack brand", () => {
  test("home page carries the name, tagline and plan pricing", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/FinTrack: Your finances\. In focus\./);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your finances. In focus.");
    const pricing = page.locator("#pricing");
    await expect(pricing.getByRole("heading", { name: "FinTrack Free" })).toBeVisible();
    await expect(pricing.getByRole("heading", { name: "FinTrack One" })).toBeVisible();
    await expect(pricing).toContainText("₹0");
    await expect(pricing).toContainText("₹149");
    await expect(pricing).toContainText("₹1,199");
  });

  for (const path of PUBLIC) {
    test(`no old product name on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("body")).not.toContainText(/budget[\s-]buddy/i);
      expect(await page.title()).not.toMatch(/budget[\s-]buddy/i);
      await expect(page.getByRole("link", { name: /FinTrack/ }).first()).toBeVisible();
    });
  }

  test("icons, manifest and social image are served under the new name", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.name).toBe("FinTrack");
    expect(manifest.theme_color).toBe("#245c48");
    expect((await request.get("/icon.svg")).ok()).toBe(true);
    const apple = await request.get("/apple-icon");
    expect(apple.headers()["content-type"]).toContain("image/png");
    const og = await request.get("/opengraph-image");
    expect(og.headers()["content-type"]).toContain("image/png");
    const html = await (await request.get("/")).text();
    expect(html).toMatch(/og:site_name" content="FinTrack"/);
  });

  test("the logo renders in light and dark themes", async ({ page }) => {
    for (const theme of ["light", "dark"]) {
      await page.addInitScript((t) => localStorage.setItem("bb-theme", t), theme);
      await page.goto("/login");
      const logo = page.getByRole("link", { name: "FinTrack home" });
      await expect(logo).toBeVisible();
      await expect(logo.locator("svg")).toBeVisible();
      const box = await logo.boundingBox();
      expect(box!.width).toBeGreaterThan(80);
      await logo.screenshot({ path: `test-results/logo-${theme}.png` });
    }
  });
});
