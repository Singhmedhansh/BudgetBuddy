// Starts the production server with AI switched on, using the keys in .env.e2e. For local live testing only:
// the keys never leave this process's environment and are never printed.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const env = { ...process.env, AI_ENABLED: "true" };
for (const line of readFileSync(".env.e2e", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_ ]+?)\s*=(.*)$/);
  if (m && !(m[1] in env)) env[m[1]] = m[2].trim();
}
const port = process.env.E2E_PORT ?? "3100";
spawn("npx", ["next", "start", "-p", port, "-H", "127.0.0.1"], { env, stdio: "inherit", shell: true });
