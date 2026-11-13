import { expect, test, type Page } from "@playwright/test";
import { api, minor, unique } from "./helpers";
import { ledgerBalances, spaceId } from "./ledger";

async function addAccount(page: Page, name: string, type: string, opening: string) {
  await page.goto("/app/accounts/new");
  await page.getByLabel("Account name").fill(name);
  await page.getByLabel("Account type").selectOption(type);
  await page.getByLabel(/balance|owe now/i).fill(opening);
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page).toHaveURL(/\/app\/accounts$/);
}

async function addTxn(page: Page, o: { type: "expense" | "income" | "transfer"; amount: string; account: string; to?: string; category?: string; merchant?: string }) {
  await page.goto("/app/transactions/new");
  await page.getByText(o.type, { exact: true }).click();
  await page.getByLabel("Amount").fill(o.amount);
  await page.getByLabel(o.type === "transfer" ? "From account" : "Account", { exact: true }).selectOption({ label: o.account });
  if (o.to) await page.getByLabel("To account").selectOption({ label: o.to });
  if (o.category) await page.getByLabel(o.type === "income" ? "Income source" : "Category").selectOption({ label: o.category });
  if (o.merchant) await page.getByLabel(/Merchant or payer/).fill(o.merchant);
  await page.getByRole("button", { name: "Save transaction" }).click();
}

async function balanceShownOnAccountsPage(page: Page, name: string) {
  await page.goto("/app/accounts");
  const row = page.getByRole("listitem").filter({ hasText: name });
  return minor(await row.locator(".num").first().innerText());
}

test.describe("Journey B/C: spending and transfers reconcile with the ledger", () => {
  const checking = unique("E2E Checking");
  const savings = unique("E2E Savings");
  const merchant = unique("E2E Shop");

  test("accounts start with their opening balances", async ({ page }) => {
    await addAccount(page, checking, "current", "10000");
    await addAccount(page, savings, "savings", "500");
    expect(await balanceShownOnAccountsPage(page, checking)).toBe(1_000_000);
    expect(await balanceShownOnAccountsPage(page, savings)).toBe(50_000);
  });

  test("an expense lowers the account balance, shows in history, and the displayed balance equals the ledger", async ({ page }) => {
    await addTxn(page, { type: "expense", amount: "250.75", account: checking, category: "Groceries", merchant });
    await expect(page).toHaveURL(/added=1/);
    await expect(page.getByText(merchant).first()).toBeVisible();
    const shown = await balanceShownOnAccountsPage(page, checking);
    expect(shown).toBe(1_000_000 - 25_075);
    const sb = await api();
    const ledger = await ledgerBalances(sb, await spaceId(sb));
    expect(ledger.get(checking)!.raw).toBe(shown);
  });

  test("a transfer moves money between accounts and is not recorded as spending", async ({ page }) => {
    const sb = await api();
    const sp = await spaceId(sb);
    const spendBefore = await expenseTotal(sb, sp);
    await addTxn(page, { type: "transfer", amount: "1000", account: checking, to: savings });
    await expect(page).toHaveURL(/added=1/);
    expect(await balanceShownOnAccountsPage(page, checking)).toBe(1_000_000 - 25_075 - 100_000);
    expect(await balanceShownOnAccountsPage(page, savings)).toBe(50_000 + 100_000);
    expect(await expenseTotal(sb, sp)).toBe(spendBefore); // no expense was created by the transfer
    const ledger = await ledgerBalances(sb, sp);
    expect(ledger.get(checking)!.raw + ledger.get(savings)!.raw).toBe(1_000_000 - 25_075 + 50_000); // money is conserved
  });

  test("invalid input is rejected without saving anything", async ({ page }) => {
    await page.goto("/app/transactions/new");
    await page.getByLabel("Amount").fill("12.345");
    await page.getByRole("button", { name: "Save transaction" }).click();
    // Every problem is reported at once, in plain words (no internal validation text).
    await expect(page.getByText("Choose an account.").or(page.getByText("Choose or fill in this field.")).first()).toBeVisible();
    await expect(page.getByText(/decimal|digits|places/i).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Invalid input");
    await page.getByLabel("Account", { exact: true }).selectOption({ label: checking });
    await page.getByLabel("Category").selectOption({ index: 1 });
    await page.getByLabel("Amount").fill("0");
    await page.getByRole("button", { name: "Save transaction" }).click();
    await expect(page.getByText(/greater than zero/i)).toBeVisible();
    expect(await balanceShownOnAccountsPage(page, checking)).toBe(1_000_000 - 25_075 - 100_000);
  });

  test("the dashboard shows the same spending the ledger holds", async ({ page }) => {
    const sb = await api();
    const sp = await spaceId(sb);
    await page.goto("/app");
    const tile = page.getByText("Spending this month").locator("xpath=..");
    const shown = minor(await tile.locator(".num").first().innerText());
    expect(shown).toBe(await expenseTotal(sb, sp, true));
  });
});

/** Sum of expense legs hitting expense categories (this month if `month`), net of reversals/refunds, from raw entries. */
async function expenseTotal(sb: Awaited<ReturnType<typeof api>>, sp: string, month = false) {
  const { data } = await sb.from("ledger_entries").select("amount,categories!inner(kind),transactions!inner(status,occurred_at,type)").eq("space_id", sp).eq("categories.kind", "expense");
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 6 * 3600e3;
  return (data as unknown as { amount: number | string; transactions: { status: string; occurred_at: string } }[])
    .filter((e) => e.transactions.status === "posted" && (!month || Date.parse(e.transactions.occurred_at) >= start))
    .reduce((s, e) => s + Number(e.amount), 0);
}

test.describe("Journey D: refund and reversal keep history and balances correct", () => {
  const acct = unique("E2E Refund Acct");
  const shop = unique("E2E RefundShop");
  const bal = () => api().then(async (sb) => (await ledgerBalances(sb, await spaceId(sb))).get(acct)!.raw);
  const row = (page: Page) => page.getByRole("listitem").filter({ hasText: shop });

  test("expense, partial refund, over-refund refused", async ({ page }) => {
    await addAccount(page, acct, "current", "5000");
    await addTxn(page, { type: "expense", amount: "400", account: acct, category: "Groceries", merchant: shop });
    await expect(page).toHaveURL(/added=1/);
    expect(await bal()).toBe(460_000);

    await page.goto(`/app/transactions?q=${encodeURIComponent(shop)}`);
    await row(page).first().getByRole("link", { name: /^Refund/ }).click();
    await expect(page.getByLabel("Refund amount")).toHaveValue("400.00");
    await page.getByLabel("Refund amount").fill("100");
    await page.getByRole("button", { name: "Record refund" }).click();
    await expect(page).toHaveURL(/refunded=1/);
    expect(await bal()).toBe(470_000); // 5000 - 400 + 100

    await page.goto(`/app/transactions?q=${encodeURIComponent(shop)}`);
    await row(page).filter({ hasText: /^.*E2E RefundShop/ }).last().getByRole("link", { name: /^Refund/ }).click();
    await expect(page.getByText(/left to refund/i).first()).toContainText("300");
    await page.getByLabel("Refund amount").fill("300.01");
    await page.getByRole("button", { name: "Record refund" }).click();
    await expect(page.getByText(/more than what is left to refund/i)).toBeVisible();
    expect(await bal()).toBe(470_000); // nothing was saved
  });

  test("reversals add offsetting entries; the full history stays visible; balances return", async ({ page }) => {
    const sb = await api();
    const sp = await spaceId(sb);
    const before = (await sb.from("transactions").select("id", { count: "exact", head: true }).eq("space_id", sp)).count!;
    await page.goto(`/app/transactions?q=${encodeURIComponent(shop)}`);
    // reverse the refund first (the expense cannot be reversed while a refund is active)
    const refundRow = page.getByRole("listitem").filter({ hasText: `Refund: ${shop}` }).first();
    await refundRow.getByRole("button", { name: /Reverse/ }).click();
    await expect(page).toHaveURL(/reversed=1/);
    expect(await bal()).toBe(460_000);
    await page.goto(`/app/transactions?q=${encodeURIComponent(shop)}`);
    await page.getByRole("listitem").filter({ hasText: shop }).filter({ hasNotText: "Refund:" }).first().getByRole("button", { name: /Reverse/ }).click();
    await expect(page).toHaveURL(/reversed=1/);
    expect(await bal()).toBe(500_000);
    // nothing was deleted: the originals and both reversals are all still on record
    const after = (await sb.from("transactions").select("id", { count: "exact", head: true }).eq("space_id", sp)).count!;
    expect(after).toBe(before + 2);
    await page.goto(`/app/transactions?q=${encodeURIComponent(shop)}`);
    await expect(page.getByText("Reversed").first()).toBeVisible();
  });

  test("reversing an expense that still has a refund is refused (needs migration 8 on the live project)", async ({ page }) => {
    test.skip(process.env.E2E_MIGRATION8 !== "1", "migration 8 is not applied to the live project yet");
    const a2 = unique("E2E Refund2");
    const s2 = unique("E2E Shop2");
    await addAccount(page, a2, "current", "1000");
    await addTxn(page, { type: "expense", amount: "100", account: a2, category: "Groceries", merchant: s2 });
    await page.goto(`/app/transactions?q=${encodeURIComponent(s2)}`);
    await page.getByRole("listitem").filter({ hasText: s2 }).first().getByRole("link", { name: /^Refund/ }).click();
    await page.getByRole("button", { name: "Record refund" }).click();
    await page.goto(`/app/transactions?q=${encodeURIComponent(s2)}`);
    await page.getByRole("listitem").filter({ hasText: s2 }).filter({ hasNotText: "Refund:" }).first().getByRole("button", { name: /Reverse/ }).click();
    await expect(page.getByText(/Reverse the refund first/i)).toBeVisible();
  });
});

test.describe("Transaction list: duplicate submits, filters, sorting and pagination", () => {
  const tag = unique("Bulk");
  const acct = unique("E2E Bulk Acct");

  test("submitting the same form twice records one transaction", async ({ page }) => {
    await addAccount(page, acct, "current", "1000");
    await page.goto("/app/transactions/new");
    await page.getByLabel("Amount").fill("12.50");
    await page.getByLabel("Account", { exact: true }).selectOption({ label: acct });
    await page.getByLabel("Category").selectOption({ label: "Groceries" });
    await page.getByLabel(/Merchant or payer/).fill(`${tag} dup`);
    await page.evaluate(() => {
      const f = document.querySelector("form:has(input[name=clientKey])") as HTMLFormElement;
      f.requestSubmit();
      f.requestSubmit();
    });
    await expect(page).toHaveURL(/added=1/);
    const sb = await api();
    const { count } = await sb.from("transactions").select("id", { count: "exact", head: true }).eq("merchant", `${tag} dup`);
    expect(count).toBe(1);
  });

  test("30 transactions page correctly, filter in the database, and sort", async ({ page }) => {
    const sb = await api();
    const sp = await spaceId(sb);
    const { data: a } = await sb.from("accounts").select("id").eq("name", acct).single();
    const { data: cat } = await sb.from("categories").select("id").eq("space_id", sp).eq("name", "Groceries").single();
    for (let i = 1; i <= 30; i++) {
      const amt = i * 100;
      const { error } = await sb.rpc("post_transaction", { p_space: sp, p_type: "expense", p_occurred_at: new Date(Date.now() - i * 60_000).toISOString(), p_currency: "INR", p_amount: amt, p_entries: [{ account_id: a!.id, amount: -amt }, { category_id: cat!.id, amount: amt }], p_merchant: `${tag} #${String(i).padStart(2, "0")}` });
      expect(error).toBeNull();
    }
    await page.goto(`/app/transactions?q=${encodeURIComponent(tag)}`);
    await expect(page.getByText(/Showing 1 to 25 of 31/)).toBeVisible(); // 30 + the duplicate-submit one
    await expect(page.getByRole("listitem").filter({ hasText: tag })).toHaveCount(25);
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page.getByText(/Showing 26 to 31 of 31/)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: tag })).toHaveCount(6);
    // account filter is applied in the database, not after a row limit
    await page.goto(`/app/transactions?account=${a!.id}`);
    await expect(page.getByText(/of 32/)).toBeVisible(); // opening balance + 31
    // sorting by amount
    await page.goto(`/app/transactions?q=${encodeURIComponent(tag)}&sort=amount_desc`);
    await expect(page.locator("main li").first()).toContainText(`${tag} #30`);
    await page.goto(`/app/transactions?q=${encodeURIComponent(tag)}&sort=amount_asc`);
    await expect(page.locator("main li").first()).toContainText(`${tag} #01`);
    // a stale page number lands on the last page instead of an empty list
    await page.goto(`/app/transactions?q=${encodeURIComponent(tag)}&page=99`);
    await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
  });
});
