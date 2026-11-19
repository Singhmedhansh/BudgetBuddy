/**
 * Live-provider test of the gateway. SKIPPED unless AI_LIVE_TEST=1 and real keys are in the environment, so CI and
 * ordinary runs never spend quota. Run: node --env-file=.env.e2e node_modules/vitest/vitest.mjs run src/server/ai/live.test.ts
 * with AI_LIVE_TEST=1. Makes at most three tiny calls and never prints a key.
 */
import { describe, expect, it } from "vitest";
import { readAiConfig } from "./config";
import { generate, KeyPool } from "./router";

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
});
