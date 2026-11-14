import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { api, minor, unique, choose, pickDate } from "./helpers";
import { ledgerBalances } from "./ledger";

/**
 * Journeys A, E, F plus budget thresholds. Each run works in its own freshly
 * created space, so results never depend on what earlier runs left behind.
 */
const STATE = "e2e/.auth/space.json";
const saved = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as { name: string; id: string; at: number }) : null;
// A failed test restarts the worker, so the space created by the first test is remembered on disk for this run.
const fresh = !saved || Date.now() - saved.at > 20 * 60_000 || process.env.E2E_NEW_SPACE === "1";
const SPACE = fresh ? unique("E2E Space") : saved!.name;
let spaceId = fresh ? "" : saved!.id;

// Every test gets a fresh browser context, so the active-space choice is set explicitly.
test.beforeEach(async ({ context, baseURL }) => {
  if (spaceId) await context.addCookies([{ name: "bb-space", value: spaceId, url: baseURL! }]);
});

async function accountId(sb: Awaited<ReturnType<typeof api>>, name: string) {
  const { data } = await sb.from("accounts").select("id").eq("space_id", spaceId).eq("name", name).single();
  return data!.id as string;
}
async function categoryId(sb: Awaited<ReturnType<typeof api>>, name: string, kind = "expense") {
  const { data } = await sb.from("categories").select("id").eq("space_id", spaceId).eq("name", name).eq("kind", kind).single();
  return data!.id as string;
}
async function postExpense(sb: Awaited<ReturnType<typeof api>>, acct: string, cat: string, minorAmt: number, merchant: string) {
  const { error } = await sb.rpc("post_transaction", { p_space: spaceId, p_type: "expense", p_occurred_at: new Date().toISOString(), p_currency: "INR", p_amount: minorAmt, p_entries: [{ account_id: acct, amount: -minorAmt }, { category_id: cat, amount: minorAmt }], p_merchant: merchant });
  expect(error).toBeNull();
}
async function addAccount(page: Page, name: string, opening: string, type = "current") {
  await page.goto("/app/accounts/new");
  await page.getByLabel("Account name").fill(name);
  await choose(page, "Account type", type);
  await page.getByLabel(/balance|owe now/i).fill(opening);
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page).toHaveURL(/\/app\/accounts/);
}

test.describe.serial("Journey A: a new space from nothing to a working dashboard", () => {
  test("create a space, add an account and income, create a budget, read the dashboard", async ({ page }) => {
    await page.goto("/app/spaces/new");
    await page.getByLabel("Space name").fill(SPACE);
    await page.getByRole("button", { name: "Create space" }).click();
    await expect(page).toHaveURL(/\/app\/members\?created=1/);
    const sb = await api();
    const { data: sp } = await sb.from("financial_spaces").select("id").eq("name", SPACE).single();
    spaceId = sp!.id as string;
    mkdirSync("e2e/.auth", { recursive: true });
    writeFileSync(STATE, JSON.stringify({ name: SPACE, id: spaceId, at: Date.now() }));

    // empty state on a brand-new space
    await page.goto("/app");
    await expect(page.getByText("Start with an account")).toBeVisible();

    await addAccount(page, "Main", "1000");
    await page.goto("/app/transactions/new");
    await page.getByText("income", { exact: true }).click();
    await page.getByLabel("Amount").fill("50000");
    await choose(page, /^Account$/, { label: "Main" });
    await choose(page, "Income source", { label: "Salary" });
    await page.getByLabel(/Merchant or payer/).fill("Acme");
    await page.getByRole("button", { name: "Save transaction" }).click();
    await expect(page).toHaveURL(/added=1/);

    await page.goto("/app/budgets/new");
    await page.waitForLoadState("networkidle"); // let the form hydrate before typing
    await page.getByLabel("Dining").fill("1000");
    await page.getByRole("button", { name: "Create budget" }).click();
    await expect(page).toHaveURL(/\/app\/budgets$/);

    // dashboard figures equal the ledger
    await page.goto("/app");
    const money = async (label: string) => minor(await page.getByText(label, { exact: true }).first().locator("xpath=..").locator(".num").first().innerText());
    expect(await money("Income this month")).toBe(5_000_000); // opening balance is not income
    expect(await money("Spending this month")).toBe(0);
    expect(minor(await page.getByRole("region", { name: "Net worth" }).locator(".num").first().innerText())).toBe(5_100_000);
    const ledger = await ledgerBalances(sb, spaceId);
    expect(ledger.get("Main")!.raw).toBe(5_100_000);
    await expect(page.getByText("Every budgeted category is within its limit.")).toBeVisible();
  });

  test("the new space is isolated from the other space, and switching works", async ({ page }) => {
    await page.goto("/app/transactions");
    await expect(page.getByText("Acme").first()).toBeVisible();
    await expect(page.getByText("HDFC Savings")).toHaveCount(0); // not from the other space
    // switch to the person's first space and back
    await page.locator("summary[aria-label='Switch space']").first().click();
    await page.getByRole("button", { name: /bb-e2e-test's finances/ }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/app/accounts");
    await expect(page.getByText("HDFC Savings")).toBeVisible();
    await expect(page.getByText("Main", { exact: true })).toHaveCount(0);
    await page.locator("summary[aria-label='Switch space']").first().click();
    await page.getByRole("button", { name: new RegExp(SPACE) }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator("summary[aria-label='Switch space']").first()).toContainText(SPACE);
    await page.goto("/app/accounts");
    await expect(page.getByText("Main", { exact: true })).toBeVisible();
  });
});

test.describe.serial("Budget thresholds: 0%, 50%, 80%, 100%, 108%, 150%", () => {
  test("percentages, wording and the dashboard watch list follow spending", async ({ page }) => {
    const sb = await api();
    const main = await accountId(sb, "Main");
    const dining = await categoryId(sb, "Dining");
    const line = () => page.getByRole("listitem").filter({ hasText: "Dining" }).filter({ hasText: "used" });
    const check = async (used: string, text: RegExp) => {
      await page.goto("/app/budgets");
      await expect(line()).toContainText(`${used}% used`);
      await expect(line()).toContainText(text);
    };
    await check("0", /left/);
    await postExpense(sb, main, dining, 50_000, "E2E dine 1");
    await check("50", /500\.00 left/);
    await postExpense(sb, main, dining, 30_000, "E2E dine 2");
    await check("80", /near your limit/);
    await page.goto("/app");
    await expect(page.getByRole("region", { name: "Budget watch" })).toContainText("Dining");
    await postExpense(sb, main, dining, 20_000, "E2E dine 3");
    await check("100", /near your limit|0\.00 left/); // exactly at the limit is not yet "over"
    await expect(page.getByText(/Over by/)).toHaveCount(0);
    await postExpense(sb, main, dining, 8_000, "E2E dine 4");
    await check("108", /Over by .*80\.00/);
    await postExpense(sb, main, dining, 42_000, "E2E dine 5");
    await check("150", /Over by .*500\.00/);
    await page.goto("/app");
    await expect(page.getByRole("region", { name: "Budget watch" })).toContainText("Over by");
  });

  test("editing a budget changes the limit immediately; archiving removes it but keeps transactions", async ({ page }) => {
    await page.goto("/app/budgets");
    await page.getByRole("link", { name: /^Edit / }).first().click();
    await expect(page).toHaveURL(/\/edit$/);
    await page.getByLabel("Dining", { exact: true }).fill("2000");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/updated=1/);
    await expect(page.getByRole("listitem").filter({ hasText: "Dining" }).filter({ hasText: "used" })).toContainText("75% used"); // 1500 of 2000
    await page.getByRole("button", { name: /^Archive / }).first().click();
    await expect(page.getByText("Budget archived")).toBeVisible();
    await expect(page.getByText("No budgets yet")).toBeVisible();
    await page.goto("/app/transactions?q=E2E+dine");
    await expect(page.getByText(/of 5/)).toBeVisible(); // spending history is untouched
  });

  test("an invalid warning threshold gets a plain message", async ({ page }) => {
    await page.goto("/app/budgets/new");
    await page.getByLabel("Dining").fill("100");
    await page.getByLabel(/Warn me when/).fill("80.5");
    await page.getByRole("button", { name: "Create budget" }).click();
    await expect(page.getByText("Use a whole number from 1 to 100.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid input");
  });
});

test.describe.serial("Journey E: savings goals", () => {
  test("create, contribute, withdraw, over-withdraw refused; account balances are unchanged", async ({ page }) => {
    const sb = await api();
    const before = (await ledgerBalances(sb, spaceId)).get("Main")!.raw;
    await page.goto("/app/goals/new");
    await page.getByLabel("Goal name").fill("E2E Trip");
    await page.getByLabel(/Target amount/).fill("10000");
    await page.getByRole("button", { name: "Create goal" }).click();
    await expect(page.getByRole("heading", { name: "E2E Trip" })).toBeVisible();

    const goal = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "E2E Trip" }) });
    await goal.getByLabel(/Amount/).fill("2500");
    await goal.getByRole("button", { name: "Add to goal" }).click();
    await expect(goal.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    await goal.getByLabel(/Amount/).fill("500");
    await goal.getByRole("button", { name: "Take out" }).click();
    await expect(goal.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
    await goal.getByLabel(/Amount/).fill("99999");
    await goal.getByRole("button", { name: "Take out" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(goal.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20"); // nothing changed
    expect((await ledgerBalances(sb, spaceId)).get("Main")!.raw).toBe(before); // contributions are tracked, not ledger postings
  });
});

test.describe.serial("Journey F: bills", () => {
  test("a bill appears on the calendar; marking it paid records one expense; it cannot be paid twice", async ({ page }) => {
    const sb = await api();
    const before = (await ledgerBalances(sb, spaceId)).get("Main")!.raw;
    const today = new Date().toISOString().slice(0, 10);
    await page.goto("/app/bills/new");
    await page.getByLabel("Bill name").fill("E2E Rent");
    await page.getByLabel(/Amount/).fill("2200");
    await pickDate(page, /^First due date/, today);
    await choose(page, "Pay from", { label: "Main" });
    await choose(page, /Category/, { label: "Rent" }).catch(async () => choose(page, /Category/, { index: 1 }));
    await page.getByRole("button", { name: "Add bill" }).click();
    await expect(page).toHaveURL(/\/app\/bills/);
    await expect(page.getByText("E2E Rent").first()).toBeVisible();

    await page.goto("/app/calendar");
    await expect(page.getByText("E2E Rent").first()).toBeVisible();

    await page.goto("/app/bills");
    await page.getByRole("button", { name: /Mark paid: E2E Rent/ }).click();
    await expect(page.getByText(/marked paid/i).first()).toBeVisible();
    expect((await ledgerBalances(sb, spaceId)).get("Main")!.raw).toBe(before - 220_000);
    // this month's bill is settled; the next button (if any) is for next month's occurrence, never the same due date
    await expect(page.getByText(/Upcoming · /).first()).toBeVisible(); // next occurrence rolled forward
    const { count } = await sb.from("transactions").select("id", { count: "exact", head: true }).eq("space_id", spaceId).eq("merchant", "E2E Rent");
    expect(count).toBe(1);
    await page.goto("/app/calendar");
    await expect(page.getByText("Done").first()).toBeVisible();
  });
});
