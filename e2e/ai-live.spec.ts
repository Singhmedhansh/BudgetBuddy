import { expect, test } from "@playwright/test";
import { choose } from "./helpers";
import { tinyPdf } from "../src/test/tiny-pdf";

/**
 * Live AI in a real browser against the real providers. SKIPPED unless AI_LIVE_E2E=1, and it needs a server started with
 * AI on (`node scripts/serve-with-ai.mjs`). Never runs in CI. Saves nothing to the ledger: the PDF stops at the review screen.
 */
test.skip(process.env.AI_LIVE_E2E !== "1", "live AI browser test: set AI_LIVE_E2E=1 and serve with scripts/serve-with-ai.mjs");

test("assistant answers a question about the person's own money, with figures checked", async ({ page }) => {
  await page.goto("/app/assistant");
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("Ask about your own money").fill("How much did I spend this month?");
  await page.getByRole("button", { name: "Ask" }).click();
  const conversation = page.getByRole("list", { name: "Conversation" });
  await expect(conversation.getByText(/checked against your records|Verified figures from your records/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveCount(0);
  console.log("assistant answer:", (await conversation.locator("li").last().innerText()).replace(/\s+/g, " ").slice(0, 300));
});

test("a PDF statement is read by AI into reviewable rows, with AI category suggestions", async ({ page }) => {
  const lines = ["ACME BANK Statement 01/11/2026 to 30/11/2026", "02/11/2026 SWIGGY ORDER 1234 450.00 Dr", "05/11/2026 SALARY ACME TECH NOV 50,000.00 Cr", "09/11/2026 UBER TRIP 8841 1,200.50 Dr"];
  await page.goto("/app/import");
  await page.waitForLoadState("networkidle");
  await choose(page, /Which account is this statement for/, { index: 0 });
  await page.locator("#stmt-file").setInputFiles({ name: `e2e-live-${Date.now()}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(tinyPdf(lines)) });
  await page.getByRole("button", { name: /Review the import/ }).click();
  await expect(page.getByRole("heading", { name: "Review import" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("SWIGGY ORDER 1234")).toBeVisible();
  await expect(page.getByText("SALARY ACME TECH NOV")).toBeVisible();
  await expect(page.getByText("UBER TRIP 8841")).toBeVisible();
  console.log("review rows:", await page.getByText(/Suggested by AI|Suggested from earlier/).count(), "category suggestions shown");
});

test("chat feel: a suggestion sends, Enter sends, the message shows at once, New chat clears", async ({ page }) => {
  await page.goto("/app/assistant");
  await page.waitForLoadState("networkidle");
  const conversation = page.getByRole("list", { name: "Conversation" });
  const checked = conversation.getByText(/checked against your records|Verified figures from your records/);

  await page.getByRole("button", { name: "What is my net worth right now?" }).click();
  await expect(conversation.getByText("What is my net worth right now?")).toBeVisible({ timeout: 3_000 }); // appears before the answer
  await expect(checked).toHaveCount(1, { timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();

  const box = page.getByLabel("Your question");
  await expect(page.getByRole("button", { name: "Ask" })).toBeDisabled(); // empty box cannot send
  await box.fill("How much did I spend this month?");
  await box.press("Shift+Enter"); // newline, not send
  await expect(conversation.getByText("How much did I spend this month?")).toHaveCount(0);
  await box.press("Backspace");
  await box.press("Enter");
  await expect(checked).toHaveCount(2, { timeout: 90_000 });
  await expect(box).toHaveValue("");

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByRole("heading", { name: /What would you like to know/ })).toBeVisible();
  await expect(conversation).toHaveCount(0);
});
