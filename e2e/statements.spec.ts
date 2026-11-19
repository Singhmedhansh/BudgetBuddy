import { expect, test } from "@playwright/test";
import { choose } from "./helpers";
import { tinyPdf } from "../src/test/tiny-pdf";

/**
 * Statement upload. Nothing here confirms an import, so no ledger data is written: a CSV reaches the review screen
 * (an import job in "preview", which saves nothing), and a PDF is refused cleanly while AI is switched off.
 */
test.describe("statement upload", () => {
  test("a CSV reaches the review screen with its rows, and nothing is saved yet", async ({ page }) => {
    await page.goto("/app/import");
    await page.waitForLoadState("networkidle");
    await choose(page, /Which account is this statement for/, { index: 0 });
    const csv = ["Date,Description,Amount", "02/11/2026,E2E STATEMENT COFFEE,-120.50", "05/11/2026,E2E STATEMENT SALARY,50000.00"].join("\n");
    await page.locator("#stmt-file").setInputFiles({ name: `e2e-${Date.now()}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: /Review the import/ }).click();
    await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("E2E STATEMENT COFFEE")).toBeVisible();
    await expect(page.getByText("E2E STATEMENT SALARY")).toBeVisible();
    await expect(page.getByText(/Nothing is saved until you confirm/)).toBeVisible();
  });

  test("the form offers PDF and says what the AI option sends", async ({ page }) => {
    await page.goto("/app/import");
    await expect(page.getByText(/Statement file \(\.csv or \.pdf\)/)).toBeVisible();
    await expect(page.getByLabel(/Use AI to read PDFs and suggest categories/)).toBeChecked();
    await expect(page.getByText(/never the amounts/)).toBeVisible();
  });

  test("a PDF is refused with a plain message while AI is off, and a non-PDF named .pdf is refused", async ({ page }) => {
    await page.goto("/app/import");
    await page.waitForLoadState("networkidle");
    await choose(page, /Which account is this statement for/, { index: 0 });
    await page.locator("#stmt-file").setInputFiles({ name: "november.pdf", mimeType: "application/pdf", buffer: Buffer.from(tinyPdf(["HDFC Bank Statement", "02/11/2026 SWIGGY 450.00"])) });
    await page.getByRole("button", { name: /Review the import/ }).click();
    await expect(page.locator("#stmt-help")).toContainText(/AI reading is not switched on yet/);

    await choose(page, /Which account is this statement for/, { index: 0 });
    await page.locator("#stmt-file").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf") });
    await page.getByRole("button", { name: /Review the import/ }).click();
    await expect(page.locator("#stmt-help")).toContainText(/does not look like a PDF/);
  });
});
