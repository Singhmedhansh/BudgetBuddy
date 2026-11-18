// Navigation timing harness. Usage: node scripts/perf/measure.mjs [baseUrl] [label]
// Reads E2E_USER_EMAIL / E2E_USER_PASSWORD from .env.e2e. Writes scripts/perf/results-<label>.json.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

for (const line of readFileSync(".env.e2e", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const base = process.argv[2] ?? "http://127.0.0.1:3100";
const label = process.argv[3] ?? "run";
const routes = ["/app", "/app/transactions", "/app/accounts", "/app/budgets", "/app/analytics", "/app/forecast", "/app/goals", "/app/assistant", "/app/settings", "/app/income", "/app/bills", "/app/subscriptions", "/app/debt", "/app/calendar"];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const t0 = Date.now();
await page.goto(base + "/login");
await page.getByLabel("Email").fill(process.env.E2E_USER_EMAIL);
await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_USER_PASSWORD);
await page.getByRole("button", { name: /log in|sign in/i }).click();
await page.waitForURL(/\/app/, { timeout: 120000 });
await page.locator("aside a[href=\"/app/budgets\"]").first().waitFor({ timeout: 120000 });
const loginMs = Date.now() - t0;

const out = { base, loginMs, hard: [], soft: [] };
const vitals = () => page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  return { ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null,
    js: Math.round(performance.getEntriesByType("resource").filter((r) => r.name.endsWith(".js")).reduce((a, r) => a + (r.encodedBodySize || 0), 0) / 1024) };
});
for (const r of routes) {
  const s = Date.now();
  await page.goto(base + r, { waitUntil: "load", timeout: 120000 });
  await page.locator("main h1, main h2").first().waitFor({ timeout: 120000 }).catch(() => {});
  out.hard.push({ route: r, total: Date.now() - s, ...(await vitals()) });
}
// client-side navigation: click sidebar links starting from the dashboard
await page.goto(base + "/app"); await page.locator("aside a[href=\"/app/budgets\"]").first().waitFor({ timeout: 120000 });
for (const r of routes.slice(1, 9)) {
  const s = Date.now();
  await page.locator(`aside a[href="${r}"]`).first().click();
  await page.waitForURL("**" + r, { timeout: 120000, waitUntil: "commit" });
  await page.locator("main h1, main h2").first().waitFor({ timeout: 120000 }).catch(() => {});
  out.soft.push({ route: r, total: Date.now() - s });
}
await browser.close();
writeFileSync(`scripts/perf/results-${label}.json`, JSON.stringify(out, null, 1));
console.table(out.hard); console.table(out.soft); console.log("login ms", loginMs);
