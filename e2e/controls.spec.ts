import { expect, test } from "@playwright/test";

test.describe("select and calendar controls", () => {
  test("the select opens a styled list, filters by typing, and closes on Escape", async ({ page }) => {
    await page.goto("/app/accounts/new");
    const type = page.getByRole("combobox", { name: "Account type" });
    await type.click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(list.getByText("Money you hold")).toBeVisible();
    await expect(list.getByText("Money you owe")).toBeVisible();
    await page.waitForTimeout(450);
    await page.screenshot({ path: "test-results/select-open.png" });
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(type).toBeFocused();

    await type.press("ArrowDown");
    await page.keyboard.type("sav");
    await page.keyboard.press("Enter");
    await expect(type).toContainText("Savings");
    // the hidden native field carries the value that submits
    expect(await page.locator("select[name=type]").inputValue()).toBe("savings");
  });

  test("the select closes on an outside click", async ({ page }) => {
    await page.goto("/app/accounts/new");
    await page.getByRole("combobox", { name: "Account type" }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test("the calendar chooses a date, blocks future days where not allowed, and moves by keyboard", async ({ page }) => {
    await page.goto("/app/subscriptions/new");
    const field = page.getByRole("button", { name: /^First due date/ });
    await field.click();
    const dialog = page.getByRole("dialog", { name: "Choose a date" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(450);
    await page.screenshot({ path: "test-results/calendar-open.png" });

    const todayCell = dialog.locator("[aria-current=date]");
    await expect(todayCell).toBeVisible();
    const iso = await todayCell.getAttribute("data-iso");

    // arrow keys move the focused day; Enter chooses it
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-iso"));
    expect(focused).not.toBe(iso);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    expect(await page.locator("input[name=firstDue]").inputValue()).toBe(focused);
    await expect(field).toBeFocused();
  });

  test("the calendar switches month and jumps by month name", async ({ page }) => {
    await page.goto("/app/subscriptions/new");
    await page.getByRole("button", { name: /^First due date/ }).click();
    const dialog = page.getByRole("dialog", { name: "Choose a date" });
    const title = dialog.getByRole("button", { name: /^[A-Z][a-z]+ \d{4}$/ });
    const before = await title.textContent();
    await dialog.getByRole("button", { name: "Previous month" }).click();
    expect(await title.textContent()).not.toBe(before);
    await title.click();
    await dialog.getByRole("button", { name: "Mar" }).click();
    await expect(dialog.getByRole("button", { name: /^March \d{4}$/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("a minimum date disables earlier days", async ({ page }) => {
    await page.goto("/app/goals/new");
    await page.getByRole("button", { name: /^Target date/ }).click();
    const dialog = page.getByRole("dialog", { name: "Choose a date" });
    const cell = dialog.locator("[aria-current=date]");
    if (await cell.count()) {
      const d = new Date((await cell.getAttribute("data-iso"))! + "T00:00:00");
      d.setDate(d.getDate() - 2);
      const prev = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      await expect(dialog.locator(`[data-iso="${prev}"]`)).toBeDisabled();
    }
  });

  test("dark theme popovers stay readable", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("bb-theme", "dark"));
    await page.goto("/app/subscriptions/new");
    await page.getByRole("button", { name: /^First due date/ }).click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: "test-results/calendar-dark.png" });
    await page.keyboard.press("Escape");
    await page.getByRole("combobox").first().click();
    await page.waitForTimeout(450);
    await page.screenshot({ path: "test-results/select-dark.png" });
  });
});
