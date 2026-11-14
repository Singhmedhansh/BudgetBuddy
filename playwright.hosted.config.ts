import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Smoke tests against a deployed URL (HOSTED_URL). Uses the same disposable test identity as the local suite.
try {
  for (const line of readFileSync(".env.e2e", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  /* credentials may come from the environment */
}

export default defineConfig({
  testDir: "./e2e-hosted",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.HOSTED_URL, trace: "retain-on-failure", screenshot: "only-on-failure", channel: "chrome" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
});
