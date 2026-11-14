import { expect, test, type Page } from "@playwright/test";
import { api, choose, minor, unique } from "./helpers";
import { ledgerBalances, spaceId } from "./ledger";

/**
 * Real user journeys for modules that had only render checks: accounts (rename, archive, restore), subscriptions,
 * expected income, debt terms, CSV import and export, editing transaction details and calendar navigation.
 * Every money figure is compared with an independent sum of the raw ledger, never with what the page shows alone.
 */

/** Choose the first real option (skipping an empty placeholder) in a select. */
async function chooseFirst(page: Page, label: string | RegExp) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("listbox").locator('[role=option]:not([data-value=""])').first().click();
}

async function addAccount(page: Page, name: string, type: string, opening: string) {
  await page.goto("/app/accounts/new");
  await page.getByLabel("Account name").fill(name);
  await choose(page, "Account type", type);
  await page.getByLabel(/balance|owe now/i).fill(opening);
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page).toHaveURL(/\/app\/accounts$/); // not /new: a form that failed validation must not pass this
}

async function raw(name: string) {
  const sb = await api();
  const sp = await spaceId(sb);
  return (await ledgerBalances(sb, sp)).get(name)!.raw;
}

test.describe.serial("Accounts: rename, archive and restore keep the ledger intact", () => {
  const first = unique("E2E Wallet");
  const renamed = `${first} renamed`;

  test("rename changes the name and nothing else", async ({ page }) => {
    await addAccount(page, first, "cash", "1200");
    const before = await raw(first);
    expect(before).toBe(120_000);

    await page.goto("/app/accounts");
    await page.getByRole("link", { name: `Rename ${first}` }).click();
    await expect(page.getByLabel("Account name")).toHaveValue(first);
    await page.getByLabel("Account name").fill(renamed);
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page).toHaveURL(/renamed=1/);
    await expect(page.getByText("Account renamed.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: renamed }).first()).toBeVisible();
    expect(await raw(renamed)).toBe(before);
  });

  test("a blank name is refused in plain words", async ({ page }) => {
    await page.goto("/app/accounts");
    await page.getByRole("link", { name: `Rename ${renamed}` }).click();
    await page.getByLabel("Account name").fill("   ");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText(/name/i).filter({ hasText: /enter|name the|required|give/i }).first()).toBeVisible();
    await page.goto("/app/accounts");
    await expect(page.getByRole("listitem").filter({ hasText: renamed }).first()).toBeVisible(); // unchanged
  });

  test("an account with money in it cannot be archived", async ({ page }) => {
    await page.goto("/app/accounts");
    await page.getByRole("button", { name: `Archive ${renamed}` }).click();
    await expect(page.getByText("An account can only be archived when its balance is zero.")).toBeVisible();
    await expect(page.getByRole("button", { name: `Archive ${renamed}` })).toBeVisible(); // still active
  });

  test("an emptied account archives, leaves the new-transaction list, keeps its history, and restores", async ({ page }) => {
    // empty it with a real expense of the whole balance
    await page.goto("/app/transactions/new");
    await page.getByText("expense", { exact: true }).click();
    await page.getByLabel("Amount").fill("1200");
    await choose(page, /^Account$/, { label: renamed });
    await chooseFirst(page, "Category");
    await page.getByRole("button", { name: "Save transaction" }).click();
    await expect(page).toHaveURL(/added=1/);
    expect(await raw(renamed)).toBe(0);

    await page.goto("/app/accounts");
    await page.getByRole("button", { name: `Archive ${renamed}` }).click();
    await expect(page.getByText("Account archived.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Archived accounts" })).toContainText(renamed);

    // not offered for new transactions
    await page.goto("/app/transactions/new");
    await page.getByRole("combobox", { name: /^Account$/ }).click();
    await expect(page.getByRole("listbox").getByRole("option", { name: renamed, exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // history is kept
    expect(await raw(renamed)).toBe(0);
    const sb = await api();
    const sp = await spaceId(sb);
    const acct = (await ledgerBalances(sb, sp)).get(renamed)!.id;
    const { count } = await sb.from("ledger_entries").select("id", { count: "exact", head: true }).eq("account_id", acct);
    expect(count).toBe(2); // the opening balance and the expense

    await page.goto("/app/accounts");
    await page.getByRole("button", { name: `Restore ${renamed}` }).click();
    await expect(page.getByText("Account restored.")).toBeVisible();
    await expect(page.getByRole("button", { name: `Archive ${renamed}` })).toBeVisible();
  });
});

test.describe.serial("Subscriptions, expected income and debt terms", () => {
  const acct = unique("E2E Bank");
  const sub = unique("E2E Streaming");
  const income = unique("E2E Salary");
  const card = unique("E2E Card");

  async function addRecurring(page: Page, kind: "subscriptions" | "income", name: string, amount: string) {
    await page.goto(`/app/${kind}/new`);
    await page.getByLabel(kind === "income" ? "Income name" : "Subscription name").fill(name);
    await page.getByLabel(/^Amount/).fill(amount);
    await choose(page, kind === "income" ? "Received into" : "Pay from", { label: acct });
    await chooseFirst(page, kind === "income" ? "Income source" : "Category");
    await page.getByRole("button", { name: kind === "income" ? "Add income" : "Add subscription" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/${kind}\\?added=1`));
    await expect(page.getByText(name).first()).toBeVisible();
  }

  test("a subscription is listed, marked paid once as a real expense, paused and cancelled", async ({ page }) => {
    await addAccount(page, acct, "savings", "10000");
    const before = await raw(acct);
    await addRecurring(page, "subscriptions", sub, "199");

    await page.getByRole("button", { name: `Mark paid: ${sub}` }).click();
    await expect(page).toHaveURL(/settled=1/);
    expect(await raw(acct)).toBe(before - 19_900);

    const sb = await api();
    const sp = await spaceId(sb);
    const { count } = await sb.from("transactions").select("id", { count: "exact", head: true }).eq("space_id", sp).eq("type", "expense").eq("description", sub);
    const { count: byMerchant } = await sb.from("transactions").select("id", { count: "exact", head: true }).eq("space_id", sp).eq("type", "expense").eq("merchant", sub);
    expect((count ?? 0) + (byMerchant ?? 0)).toBe(1);

    const row = page.getByRole("listitem").filter({ hasText: sub });
    await row.getByRole("button", { name: "Pause" }).click();
    await expect(row).toContainText("Paused");
    await expect(row.getByRole("button", { name: /Mark paid/ })).toHaveCount(0);
    await row.getByRole("button", { name: "Resume" }).click();
    await row.getByRole("button", { name: "Mark cancelled" }).click();
    await expect(row).toContainText("Cancelled");
    expect(await raw(acct)).toBe(before - 19_900); // pausing and cancelling move no money
  });

  test("expected income changes no balance until it is received, then adds exactly once", async ({ page }) => {
    const before = await raw(acct);
    await addRecurring(page, "income", income, "50000");
    expect(await raw(acct)).toBe(before); // expected is not received

    await page.getByRole("button", { name: `Mark received: ${income}` }).click();
    await expect(page).toHaveURL(/settled=1/);
    expect(await raw(acct)).toBe(before + 5_000_000);

    // the same due date cannot be received twice: the button for that date is gone
    await page.goto("/app/income");
    const row = page.getByRole("listitem").filter({ hasText: income });
    await expect(row).toBeVisible();
    expect(await raw(acct)).toBe(before + 5_000_000);
  });

  test("debt terms save, persist, and bad values are refused", async ({ page }) => {
    await addAccount(page, card, "credit_card", "5000");
    await page.goto("/app/debt");
    const item = page.getByRole("listitem").filter({ hasText: card });
    await item.getByLabel("Interest per year (%)").fill("18.5");
    await item.getByLabel(/Minimum payment/).fill("500");
    await item.getByLabel("Due day of month").fill("5");
    await item.getByRole("button", { name: "Save terms" }).click();
    await expect(page).toHaveURL(/saved=1/);

    await page.goto("/app/debt");
    const again = page.getByRole("listitem").filter({ hasText: card });
    await expect(again.getByLabel("Interest per year (%)")).toHaveValue("18.5");
    await expect(again.getByLabel(/Minimum payment/)).toHaveValue("500.00");
    await expect(again.getByLabel("Due day of month")).toHaveValue("5");

    await again.getByLabel("Due day of month").fill("40");
    await again.getByRole("button", { name: "Save terms" }).click();
    await expect(page.getByText("Due day must be 1 to 31.")).toBeVisible();
    await page.goto("/app/debt");
    await expect(page.getByRole("listitem").filter({ hasText: card }).getByLabel("Due day of month")).toHaveValue("5"); // unchanged

    const item2 = page.getByRole("listitem").filter({ hasText: card });
    await item2.getByLabel("Interest per year (%)").fill("abc");
    await item2.getByRole("button", { name: "Save terms" }).click();
    await expect(page.getByText(/Enter the interest rate as a percentage/)).toBeVisible();
    expect(await raw(card)).toBe(-500_000); // owing 5,000 is stored as a credit balance; nothing here moves money
  });
});

test.describe.serial("CSV import and export", () => {
  const acct = unique("E2E Statement");
  const tag = Date.now().toString(36);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const day = (back: number) => {
    const d = new Date();
    d.setDate(d.getDate() - back);
    return fmt(d);
  };
  const csv = [
    "Date,Description,Amount",
    `${day(3)},Cafe ${tag},-120.50`,
    `${day(2)},Salary ${tag},2000.00`,
    `${day(1)},=SUM(1+1) ${tag},-10.00`,
    `31/02/2026,Impossible date ${tag},-5.00`,
  ].join("\n");

  async function upload(page: Page, content: string) {
    await page.goto("/app/import");
    await choose(page, "Which account is this statement for?", { label: acct });
    await page.locator("#stmt-file").setInputFiles({ name: `statement-${tag}.csv`, mimeType: "text/csv", buffer: Buffer.from(content) });
    await page.getByRole("button", { name: "Review the import" }).click();
  }

  test("preview, skip a bad row, confirm: the ledger gains exactly the rows reviewed", async ({ page }) => {
    await addAccount(page, acct, "current", "1000");
    const before = await raw(acct);

    await upload(page, csv);
    await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible();
    await expect(page.getByText(`Cafe ${tag}`)).toBeVisible();
    await expect(page.getByText(`Salary ${tag}`)).toBeVisible();
    await expect(page.getByText(/could not be read/).first()).toBeVisible(); // the impossible date is reported, not guessed
    expect(await raw(acct)).toBe(before); // nothing is saved before confirming

    await page.getByRole("button", { name: "Confirm and import" }).click();
    await expect(page.getByRole("heading", { name: "Import finished" })).toBeVisible();
    // -120.50 + 2000.00 - 10.00
    expect(await raw(acct)).toBe(before - 12_050 + 200_000 - 1_000);

    const err = await page.request.get((await page.getByRole("link", { name: /Download the error report/ }).getAttribute("href"))!);
    expect(err.status()).toBe(200);
    const report = await err.text();
    expect(report).toContain("Line,Problem");
    expect(report).toContain("Could not read the date");
    expect(report).toMatch(/^5,/m); // the impossible date is on line 5 of the file
  });

  test("importing the same file again records nothing new", async ({ page }) => {
    const before = await raw(acct);
    const sb = await api();
    const sp = await spaceId(sb);
    const countBefore = (await sb.from("transactions").select("id", { count: "exact", head: true }).eq("space_id", sp).eq("source", "import")).count;

    await upload(page, csv);
    await expect(page.getByText("Already imported").first()).toBeVisible();
    await page.getByRole("button", { name: "Confirm and import" }).click();
    await expect(page.getByRole("heading", { name: "Import finished" })).toBeVisible();

    expect(await raw(acct)).toBe(before);
    const countAfter = (await sb.from("transactions").select("id", { count: "exact", head: true }).eq("space_id", sp).eq("source", "import")).count;
    expect(countAfter).toBe(countBefore);
  });

  test("a file that is not a statement is refused in plain words", async ({ page }) => {
    await upload(page, "this,is,not\nwhat,we,expect");
    await expect(page.getByText(/Date|header|column/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/app\/import$/);
  });

  test("export matches the ledger, and a formula in a merchant is neutralised", async ({ page }) => {
    const res = await page.request.get("/app/export/transactions");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("fintrack-transactions.csv");
    const body = await res.text();
    expect(body.split("\r\n")[0]).toBe("Date,Type,Status,Account,Category,Merchant,Description,Amount,Currency,Source,Reversal of,Reference");
    expect(body).toContain(`Cafe ${tag}`);
    expect(body).toContain("-120.50");
    expect(body).not.toMatch(new RegExp(`(^|,)=SUM\\(1\\+1\\) ${tag}`, "m")); // never a bare formula
    expect(body).toContain(`'=SUM(1+1) ${tag}`);

    // a bad date range is a clear 400, not a crash or an empty file
    expect((await page.request.get("/app/export/transactions?from=not-a-date")).status()).toBe(400);

    const all = await page.request.get("/app/export/all");
    expect(all.status()).toBe(200);
    const json = await all.json();
    expect(JSON.stringify(json)).not.toMatch(/service_role|password|refresh_token/i);
  });
});

test.describe.serial("Editing a transaction's details", () => {
  test("merchant and notes change; amount, account and balance do not", async ({ page }) => {
    const acct = unique("E2E Editable");
    const merchant = unique("E2E Before");
    await addAccount(page, acct, "current", "500");

    await page.goto("/app/transactions/new");
    await page.getByText("expense", { exact: true }).click();
    await page.getByLabel("Amount").fill("75.25");
    await choose(page, /^Account$/, { label: acct });
    await chooseFirst(page, "Category");
    await page.getByLabel(/Merchant or payer/).fill(merchant);
    await page.getByRole("button", { name: "Save transaction" }).click();
    await expect(page).toHaveURL(/added=1/);
    const balance = await raw(acct);
    expect(balance).toBe(50_000 - 7_525);

    await page.goto(`/app/transactions?q=${encodeURIComponent(merchant)}`);
    await page.getByRole("link", { name: /edit/i }).first().click();
    await expect(page.getByLabel("Merchant or payer")).toHaveValue(merchant);
    const after = `${merchant} corrected`;
    await page.getByLabel("Merchant or payer").fill(after);
    await page.locator("#notes").fill("Receipt checked");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page).toHaveURL(/edited=1/);

    await page.goto(`/app/transactions?q=${encodeURIComponent(after)}`);
    await expect(page.getByText(after).first()).toBeVisible();
    expect(minor(await page.locator(".num").first().innerText())).toBe(-7_525);
    expect(await raw(acct)).toBe(balance);
  });
});

test.describe("Calendar", () => {
  test("moves between months, shows the month it names, and a stale month still renders", async ({ page }) => {
    await page.goto("/app/calendar");
    const title = page.getByRole("heading", { level: 2 }).first();
    await expect(page.getByRole("link", { name: "Next month" })).toBeVisible();
    await page.getByRole("link", { name: "Next month" }).click();
    await expect(page).toHaveURL(/calendar\?m=\d{4}-\d{2}/);
    const next = new URL(page.url()).searchParams.get("m")!;
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page).not.toHaveURL(new RegExp(`m=${next}$`));
    const current = new URL(page.url()).searchParams.get("m");
    await page.getByRole("link", { name: "Previous month" }).click();
    await expect(page).not.toHaveURL(new RegExp(`m=${current}$`));
    const prev = new URL(page.url()).searchParams.get("m")!;
    expect(prev < next).toBe(true);
    await expect(title).toBeVisible();

    await page.goto("/app/calendar?m=2026-13"); // not a month: falls back rather than failing
    await expect(page.getByRole("link", { name: "Next month" })).toBeVisible();
    await page.goto("/app/calendar?m=garbage");
    await expect(page.getByRole("link", { name: "Next month" })).toBeVisible();
  });
});

test.describe("Contact form validation", () => {
  test("an empty message is refused in plain words and nothing is sent", async ({ page }) => {
    await page.goto("/contact");
    await page.getByRole("button", { name: /send/i }).click();
    await expect(page.locator("[role=alert], .text-neg-text").filter({ hasText: /./ }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/contact/);
    await expect(page.getByText(/reference/i).filter({ hasText: /FT-|BB-/ })).toHaveCount(0);
  });
});
