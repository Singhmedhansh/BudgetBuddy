import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Test identities live in .env.e2e (git-ignored). Never use a real user's credentials.
try {
  for (const line of readFileSync(".env.e2e", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  /* CI supplies these directly */
}

const PORT = Number(process.env.E2E_PORT ?? 3100);
const prod = process.env.E2E_PROD === "1";

const base = { channel: "chrome" as const };
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", ...base },
  webServer: {
    command: prod ? `npx next start -p ${PORT} -H 127.0.0.1` : `npx next dev -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    // Real viewport sizes, not iframes.
    { name: "desktop-1440", testMatch: /(flows|journeys|auth|security|responsive|settings|brand|controls|modules|concurrency|statements)\.spec\.ts/, use: { ...devices["Desktop Chrome"], ...base, viewport: { width: 1440, height: 900 }, storageState: "e2e/.auth/user.json" }, dependencies: ["setup"] },
    { name: "laptop-1280", testMatch: /responsive\.spec\.ts/, use: { ...devices["Desktop Chrome"], ...base, viewport: { width: 1280, height: 800 }, storageState: "e2e/.auth/user.json" }, dependencies: ["setup"] },
    { name: "tablet-768", testMatch: /responsive\.spec\.ts/, use: { ...devices["Desktop Chrome"], ...base, viewport: { width: 768, height: 1024 }, storageState: "e2e/.auth/user.json" }, dependencies: ["setup"] },
    { name: "mobile-390", testMatch: /responsive\.spec\.ts/, use: { ...devices["Pixel 7"], ...base, viewport: { width: 390, height: 844 }, storageState: "e2e/.auth/user.json" }, dependencies: ["setup"] },
  ],
});
