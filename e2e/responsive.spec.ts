import { expect, test, type Page } from "@playwright/test";
import { profileTheme, resetTheme } from "./helpers";

/** Runs at 1440, 1280, 768 and 390 px as real browser viewports (see playwright.config.ts). */
const PUBLIC = ["/", "/help", "/help/getting-started", "/contact", "/security", "/legal/privacy", "/login", "/signup", "/forgot-password"];
const APP = ["/app", "/app/transactions", "/app/transactions/new", "/app/accounts", "/app/accounts/new", "/app/budgets", "/app/budgets/new", "/app/goals", "/app/goals/new", "/app/bills", "/app/bills/new", "/app/subscriptions", "/app/subscriptions/new", "/app/income", "/app/income/new", "/app/calendar", "/app/debt", "/app/analytics", "/app/forecast", "/app/import", "/app/more", "/app/members", "/app/settings", "/app/settings/preferences", "/app/settings/security", "/app/settings/notifications", "/app/settings/connected", "/app/settings/privacy", "/app/assistant", "/app/spaces/new", "/app/join"];

async function overflow(page: Page) {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const bad = [...document.querySelectorAll("body *")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const st = getComputedStyle(e);
        if (r.width === 0 || st.position === "fixed" || st.visibility === "hidden") return false;
        if (e.closest("[class*='overflow-x-auto'],[class*='overflow-hidden'],[class*='overflow-y-auto'],svg,details:not([open])")) return false;
        return r.right > w + 1 || r.left < -1;
      })
      .slice(0, 3)
      .map((e) => `${e.tagName}.${String((e as HTMLElement).className).slice(0, 50)}`);
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: w, bad };
  });
}

test.describe("layout and console health on every route", () => {
  for (const path of [...PUBLIC, ...APP]) {
    test(`${path}: no horizontal overflow, no console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error" && !/favicon|Failed to load resource.*(401|404)/.test(m.text())) errors.push(m.text());
      });
      const res = await page.goto(path);
      expect(res?.status(), `${path} status`).toBeLessThan(400);
      await page.waitForLoadState("networkidle");
      const o = await overflow(page);
      expect(o.scrollWidth, `${path} scrollWidth ${o.scrollWidth} > ${o.innerWidth}; ${o.bad.join(",")}`).toBeLessThanOrEqual(o.innerWidth + 1);
      expect(o.bad, `${path} overflowing elements`).toEqual([]);
      expect(errors, `${path} console`).toEqual([]);
    });
  }
});

test.describe("navigation", () => {
  test("landing: header menus, anchors and the mobile sheet work", async ({ page, viewport }) => {
    await page.goto("/");
    const wide = (viewport?.width ?? 0) >= 1024;
    if (wide) {
      const product = page.getByRole("button", { name: "Product" });
      await product.click();
      await expect(product).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("link", { name: /See it working/ }).first()).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(product).toHaveAttribute("aria-expanded", "false");
      // keyboard: focus moves into the open menu with Tab
      await product.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await expect(page.locator("#menu-product a").first()).toBeFocused();
    } else {
      const toggle = page.getByRole("button", { name: "Open menu" });
      await toggle.click();
      await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
      const sheetPricing = page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Pricing" });
      await expect(sheetPricing).toBeVisible();
      await sheetPricing.click();
      await expect(page).toHaveURL(/#pricing/);
      await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible(); // sheet closed after navigating
    }
  });

  test("landing: every in-page and footer link resolves", async ({ page, request }) => {
    await page.goto("/");
    const hrefs = await page.$$eval("a[href]", (as) => [...new Set(as.map((a) => a.getAttribute("href")!).filter((h) => h.startsWith("/")))]);
    expect(hrefs.length).toBeGreaterThan(15);
    for (const h of hrefs) {
      const path = h.split("#")[0] || "/";
      const r = await request.get(path, { maxRedirects: 0 });
      expect(r.status(), h).toBeLessThan(400);
    }
  });

  test("back-to-top appears after scrolling and returns to the top", async ({ page }) => {
    await page.goto("/");
    const btn = page.locator("button[aria-label='Back to top']"); // role queries skip aria-hidden elements
    await expect(btn).toHaveAttribute("aria-hidden", "true");
    await page.evaluate(() => window.scrollTo({ top: 2400, behavior: "instant" }));
    await expect(btn).toHaveAttribute("aria-hidden", "false");
    await btn.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  });

  test("app: primary navigation reaches each section", async ({ page, viewport }) => {
    await page.goto("/app");
    const wide = (viewport?.width ?? 0) >= 768;
    const targets: [string, RegExp][] = [["Transactions", /\/app\/transactions/], ["Budgets", /\/app\/budgets/], ["Dashboard", /\/app$/]];
    for (const [name, url] of targets) {
      const nav = wide ? page.locator("aside").getByRole("link", { name, exact: true }) : page.locator("nav[aria-label='Main']").last().getByRole("link", { name, exact: true });
      await nav.click();
      await expect(page).toHaveURL(url);
    }
    if (!wide) {
      await page.locator("nav[aria-label='Main']").last().getByRole("link", { name: "More" }).click();
      await expect(page).toHaveURL(/\/app\/more/);
      await page.locator("nav[aria-label='Main']").last().getByRole("link", { name: "Add transaction" }).click();
      await expect(page).toHaveURL(/\/app\/transactions\/new/);
    }
  });
});

test.describe("theme and motion", () => {
  // The theme is stored on the shared test user's profile: start from a known state and leave it that way.
  test.beforeEach(async ({ page }) => {
    await resetTheme(page, "light");
  });
  test.afterEach(async ({ page }) => {
    await resetTheme(page, "light");
  });
  test("theme switching persists across reloads and changes real colours", async ({ page }) => {
    await page.goto("/");
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await bg();
    await page.getByRole("radio", { name: "Dark theme" }).click();
    await expect.poll(bg).not.toBe(light);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "Light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await profileTheme("light", expect); // the save has finished before the test ends
    expect(await bg()).toBe(light);
  });

  test("reduced motion: content is visible immediately and animations are disabled", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => window.scrollTo({ top: 3000, behavior: "instant" }));
    const hidden = await page.evaluate(() => [...document.querySelectorAll(".reveal")].filter((e) => getComputedStyle(e).opacity !== "1").length);
    expect(hidden).toBe(0);
    const dur = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".anim-rise")!).animationDuration));
    expect(dur).toBeLessThan(0.01);
  });

  test("keyboard: tab order reaches the main action and focus is visible", async ({ page }) => {
    await page.goto("/login");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const st = getComputedStyle(el);
      return { tag: el.tagName, outline: st.outlineStyle, width: st.outlineWidth, shadow: st.boxShadow };
    });
    expect(outline.tag).not.toBe("BODY");
    expect(outline.outline !== "none" || outline.shadow !== "none").toBe(true);
  });
});
