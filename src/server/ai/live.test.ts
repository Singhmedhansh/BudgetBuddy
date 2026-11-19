/**
 * Live-provider test of the gateway. SKIPPED unless AI_LIVE_TEST=1 and real keys are in the environment, so CI and
 * ordinary runs never spend quota. Run: node --env-file=.env.e2e node_modules/vitest/vitest.mjs run src/server/ai/live.test.ts
 * with AI_LIVE_TEST=1. Makes at most three tiny calls and never prints a key.
 */
import { describe, expect, it } from "vitest";
import { readAiConfig } from "./config";
import { generate, KeyPool } from "./router";
import { categoriseWithAi, readStatementWithAi } from "./statement";
import type { UsageStore } from "./assistant";

const env = { ...process.env, GEMINI_API_KEYS: process.env.GEMINI_API_KEYS ?? process.env["GEMINI_API_KEYS "], GROQ_API_KEYS: process.env.GROQ_API_KEYS ?? process.env["GROQ_API_KEYS "], AI_ENABLED: "true" };
const live = process.env.AI_LIVE_TEST === "1" && Boolean(env.GEMINI_API_KEYS) && Boolean(env.GROQ_API_KEYS);
const req = { system: "Answer in one short sentence.", messages: [{ role: "user" as const, content: "What is 2 plus 2?" }], maxOutputTokens: 700 };
const pools = () => {
  const m = new Map<string, KeyPool>();
  return (id: string, keys: string[]) => m.get(id) ?? (m.set(id, new KeyPool(keys)), m.get(id)!);
};

describe.skipIf(!live)("gateway against the real providers", () => {
  it("answers through the preferred provider with the configured models", async () => {
    const r = await generate(readAiConfig(env), req, undefined, pools());
    expect(r.text.length).toBeGreaterThan(0);
    expect(["gemini", "groq"]).toContain(r.provider);
    console.log(`live: answered by ${r.provider} / ${r.model} after ${r.attempts} attempt(s), ${r.fallbacks} fallback(s)`);
  }, 120_000);

  it("falls back to Groq when every Gemini key is rejected, without retrying the bad keys", async () => {
    const bogus = readAiConfig({ ...env, GEMINI_API_KEYS: "invalid-key-one,invalid-key-two" });
    const r = await generate(bogus, req, undefined, pools());
    expect(r.provider).toBe("groq");
    expect(r.fallbacks).toBeGreaterThanOrEqual(1);
    expect(r.attempts).toBeLessThanOrEqual(4);
    console.log(`live: fallback worked, answered by groq / ${r.model} after ${r.attempts} attempt(s)`);
  }, 120_000);

  it("reads a statement and categorises it, with every row verified against the text", async () => {
    const usage: UsageStore = { reserve: async () => ({ allowed: true, id: 1 }), settle: async () => undefined };
    const config = readAiConfig(env);
    const text = [
      "ACME BANK  Account statement  01/11/2026 to 30/11/2026",
      "Opening balance 12,000.00",
      "Date        Narration                          Withdrawal   Deposit    Balance",
      "02/11/2026  SWIGGY ORDER 1234                  450.00                  11,550.00",
      "05/11/2026  SALARY ACME TECH NOV                            50,000.00  61,550.00",
      "09/11/2026  UBER TRIP 8841                     1,200.50                60,349.50",
      "Closing balance 60,349.50",
    ].join("\n");
    const read = await readStatementWithAi(text, { config, usage }, { currency: "INR", dateOrder: "dmy" });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    console.log("live: statement rows", JSON.stringify(read.rows.map((r) => [r.date, r.description, r.amount])), "dropped", read.problems.length);
    expect(read.rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([-120050, -45000, 5000000]);
    const cats = [
      { id: "food", name: "Food", kind: "expense" as const },
      { id: "travel", name: "Travel", kind: "expense" as const },
      { id: "salary", name: "Salary", kind: "income" as const },
    ];
    const picks = await categoriseWithAi(read.rows.map((r) => ({ description: r.description, direction: (r.amount > 0 ? "in" : "out") as "in" | "out" })), cats, { config, usage });
    console.log("live: categories", JSON.stringify([...picks.entries()]));
    expect(picks.size).toBeGreaterThanOrEqual(2);
  }, 180_000);
});
