import { describe, expect, it, vi } from "vitest";
import { ask, type UsageStore } from "./assistant";
import { readAiConfig, type AiConfig } from "./config";
import { coalesce, flightKey } from "./inflight";
import {
  AiUnavailableError,
  backoffMs,
  BACKOFF_BASE_MS,
  gatewayHealth,
  generate,
  KeyPool,
  MAX_UPSTREAM_ATTEMPTS,
} from "./router";
import { ProviderError, type ProviderClient } from "./types";
import type { Facts } from "./grounding";

const FACTS: Facts = {
  asOf: "2026-11-13",
  space: { name: "Home", currency: "INR", sample: false },
  netWorth: "120000.00",
  held: "125000.00",
  owed: "5000.00",
  accounts: [],
  thisMonth: {
    label: "November 2026",
    income: "80000.00",
    spending: "32500.50",
    net: "47499.50",
    keptPercent: 59,
  },
  topCategories: [],
  budgets: [],
};

const cfg = (
  providers: AiConfig["providers"],
  independentKeyQuota = false,
): AiConfig => ({
  enabled: true,
  providers,
  independentKeyQuota,
  limits: {
    perHour: 20,
    tokensPerDay: 60000,
    maxOutputTokens: 100,
    maxQuestionChars: 600,
    timeoutMs: 1234,
  },
});
const req = {
  system: "s",
  messages: [{ role: "user" as const, content: "q" }],
  maxOutputTokens: 50,
};
type Step = ProviderError | { text: string };

/** A scripted provider: each call consumes the next step (the last repeats). Records key, model and timeout. */
const scripted = (id: "gemini" | "groq", steps: Step[]) => {
  const calls: { key: string; model: string; timeoutMs?: number }[] = [];
  const c: ProviderClient & { calls: typeof calls } = {
    id,
    calls,
    complete: async (key, model, r) => {
      calls.push({ key, model, timeoutMs: r.timeoutMs });
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (step instanceof ProviderError) throw step;
      return { text: step.text, promptTokens: 1, completionTokens: 1 };
    },
  };
  return c;
};
const freshPools = () => {
  const m = new Map<string, KeyPool>();
  return (id: string, keys: string[]) =>
    m.get(id) ?? (m.set(id, new KeyPool(keys)), m.get(id)!);
};
const g = (keys = ["g1", "g2", "g3"], models = ["gm1", "gm2"]) => ({
  id: "gemini" as const,
  model: models[0],
  models,
  keys,
});
const q = (keys = ["q1", "q2", "q3", "q4"], models = ["qm1"]) => ({
  id: "groq" as const,
  model: models[0],
  models,
  keys,
});
const hooks = () => {
  const sleeps: number[] = [];
  return {
    sleeps,
    hooks: {
      sleep: async (ms: number) => void sleeps.push(ms),
      random: () => 0.5,
    },
  };
};

describe("gateway behaviour", () => {
  it("Gemini primary success: Groq is never contacted and the configured timeout is passed on", async () => {
    const gem = scripted("gemini", [{ text: "hi" }]);
    const gq = scripted("groq", [{ text: "no" }]);
    const r = await generate(
      cfg([g(), q()]),
      req,
      { gemini: gem, groq: gq },
      freshPools(),
    );
    expect(r).toMatchObject({
      provider: "gemini",
      model: "gm1",
      attempts: 1,
      fallbacks: 0,
      rateLimited: 0,
    });
    expect(gq.calls).toEqual([]);
    expect(gem.calls[0].timeoutMs).toBe(1234);
  });

  it("Gemini rate limit: with a shared quota the other Gemini keys are NOT tried and Groq answers", async () => {
    const gem = scripted("gemini", [new ProviderError("rate_limit", 20_000)]);
    const gq = scripted("groq", [{ text: "from groq" }]);
    const r = await generate(
      cfg([g(), q()]),
      req,
      { gemini: gem, groq: gq },
      freshPools(),
    );
    expect(r).toMatchObject({ provider: "groq", fallbacks: 1, rateLimited: 1 });
    expect(gem.calls).toHaveLength(1);
  });

  it("a rate-limited provider is not asked again while it rests, and returns afterwards", async () => {
    let now = 0;
    const pools = new Map<string, KeyPool>();
    const pool = (id: string, keys: string[]) =>
      pools.get(id) ??
      (pools.set(id, new KeyPool(keys, () => now)), pools.get(id)!);
    const gem = scripted("gemini", [
      new ProviderError("rate_limit", 30_000),
      { text: "back" },
    ]);
    const gq = scripted("groq", [{ text: "groq" }]);
    await generate(cfg([g(), q()]), req, { gemini: gem, groq: gq }, pool);
    await generate(cfg([g(), q()]), req, { gemini: gem, groq: gq }, pool);
    expect(gem.calls).toHaveLength(1); // the second question went straight to Groq
    now = 31_000;
    expect(
      (await generate(cfg([g(), q()]), req, { gemini: gem, groq: gq }, pool))
        .provider,
    ).toBe("gemini");
  });

  it("Gemini timeout: one jittered retry on the same key, then fallback to Groq", async () => {
    const gem = scripted("gemini", [new ProviderError("timeout")]);
    const gq = scripted("groq", [{ text: "ok" }]);
    const h = hooks();
    const r = await generate(
      cfg([g(["g1"]), q()]),
      req,
      { gemini: gem, groq: gq },
      freshPools(),
      h.hooks,
    );
    expect(gem.calls.map((c) => c.key)).toEqual(["g1", "g1"]);
    expect(h.sleeps).toHaveLength(1);
    expect(h.sleeps[0]).toBeLessThan(2_000);
    expect(r).toMatchObject({ provider: "groq", attempts: 3, fallbacks: 2 });
  });

  it("a transient server error that clears on retry is answered by the same provider", async () => {
    const gem = scripted("gemini", [
      new ProviderError("server"),
      { text: "second try" },
    ]);
    const r = await generate(
      cfg([g(["g1"])]),
      req,
      { gemini: gem },
      freshPools(),
      hooks().hooks,
    );
    expect(r).toMatchObject({
      text: "second try",
      provider: "gemini",
      attempts: 2,
      fallbacks: 1,
    });
  });

  it("backoff grows with the attempt, is jittered and is capped", () => {
    expect(backoffMs(0, () => 0.999)).toBeLessThan(BACKOFF_BASE_MS);
    expect(backoffMs(1, () => 0.999)).toBeLessThan(BACKOFF_BASE_MS * 2);
    expect(backoffMs(10, () => 0.999)).toBeLessThan(2_000);
    expect(backoffMs(3, () => 0)).toBe(0);
  });

  it("an invalid key is rested and the next key tried, without retrying the bad one", async () => {
    const gem = scripted("gemini", [
      new ProviderError("auth"),
      { text: "k2 works" },
    ]);
    const r = await generate(
      cfg([g(["g1", "g2"])]),
      req,
      { gemini: gem },
      freshPools(),
    );
    expect(gem.calls.map((c) => c.key)).toEqual(["g1", "g2"]);
    expect(r.text).toBe("k2 works");
  });

  it("a retired model moves to the provider's next model and is remembered", async () => {
    const gem = scripted("gemini", [
      new ProviderError("model_unavailable"),
      { text: "new model" },
    ]);
    const pool = freshPools();
    const r = await generate(cfg([g(["g1"])]), req, { gemini: gem }, pool);
    expect(gem.calls.map((c) => c.model)).toEqual(["gm1", "gm2"]);
    expect(r.model).toBe("gm2");
    await generate(cfg([g(["g1"])]), req, { gemini: gem }, pool);
    expect(gem.calls.map((c) => c.model)).toEqual(["gm1", "gm2", "gm2"]); // gm1 is not asked again
    expect(gatewayHealth(cfg([g(["g1"])]), pool)[0].modelsResting).toEqual([
      "gm1",
    ]);
  });

  it("Groq rate limit and Groq failure: with both providers unusable the question fails cleanly and within the attempt cap", async () => {
    const gem = scripted("gemini", [new ProviderError("rate_limit")]);
    const gq = scripted("groq", [new ProviderError("server")]);
    const e = await generate(
      cfg([g(), q()]),
      req,
      { gemini: gem, groq: gq },
      freshPools(),
      hooks().hooks,
    ).catch((x) => x);
    expect(e).toBeInstanceOf(AiUnavailableError);
    expect(e.cause_).toBe("all_failed");
    expect(
      e.trail.map(
        (t: { provider: string; kind: string }) => `${t.provider}:${t.kind}`,
      ),
    ).toEqual([
      "gemini:rate_limit",
      "groq:server",
      "groq:server",
      "groq:server",
    ]);
    expect(e.trail).toHaveLength(MAX_UPSTREAM_ATTEMPTS); // stops at the cap rather than trying every key
    expect(e.trail.length).toBeLessThanOrEqual(MAX_UPSTREAM_ATTEMPTS);
  });

  it("every provider resting makes no upstream call at all", async () => {
    const gem = scripted("gemini", [{ text: "x" }]);
    const pool = freshPools();
    pool("gemini", ["g1"]).markFailed("g1", new ProviderError("auth"));
    await expect(
      generate(cfg([g(["g1"])]), req, { gemini: gem }, pool),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(gem.calls).toEqual([]);
  });

  it("a bad request never falls back to another provider", async () => {
    const gem = scripted("gemini", [new ProviderError("bad_request")]);
    const gq = scripted("groq", [{ text: "should not be called" }]);
    const e = await generate(
      cfg([g(), q()]),
      req,
      { gemini: gem, groq: gq },
      freshPools(),
    ).catch((x) => x);
    expect(e.cause_).toBe("bad_request");
    expect(gq.calls).toEqual([]);
  });

  it("a malformed (empty) provider response fails over instead of returning nothing", async () => {
    const gem = scripted("gemini", [new ProviderError("empty")]);
    const gq = scripted("groq", [{ text: "real answer" }]);
    const r = await generate(
      cfg([g(["g1"]), q()]),
      req,
      { gemini: gem, groq: gq },
      freshPools(),
    );
    expect(r).toMatchObject({ text: "real answer", provider: "groq" });
  });

  it("health reports counts and model names only, never a key", () => {
    const pool = freshPools();
    pool("gemini", ["SECRET-A", "SECRET-B"]).markFailed(
      "SECRET-A",
      new ProviderError("auth"),
    );
    const h = gatewayHealth(cfg([g(["SECRET-A", "SECRET-B"])]), pool);
    expect(h).toEqual([
      {
        provider: "gemini",
        models: ["gm1", "gm2"],
        keys: 2,
        keysAvailable: 1,
        modelsResting: [],
      },
    ]);
    expect(JSON.stringify(h)).not.toMatch(/SECRET/);
  });
});

describe("duplicate requests and usage logging", () => {
  it("identical concurrent calls share one run; a later call runs again", async () => {
    const run = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "answer";
    });
    const key = flightKey("user-1", "space", "same question");
    const [a, b] = await Promise.all([coalesce(key, run), coalesce(key, run)]);
    expect([a, b]).toEqual(["answer", "answer"]);
    expect(run).toHaveBeenCalledTimes(1);
    await coalesce(key, run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("different people asking the same words never share a run (user isolation)", async () => {
    expect(flightKey("alice", "s", "q")).not.toBe(flightKey("bob", "s", "q"));
    const run = vi.fn(async () => "x");
    await Promise.all([
      coalesce(flightKey("alice", "s", "q"), run),
      coalesce(flightKey("bob", "s", "q"), run),
    ]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a failed run is not cached", async () => {
    const key = flightKey("u", "s", "boom");
    await expect(
      coalesce(key, async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow();
    await expect(coalesce(key, async () => "fine")).resolves.toBe("fine");
  });

  it("the usage record carries the failure category and counts, never a message", async () => {
    const settle = vi.fn(async () => undefined);
    const usage: UsageStore = {
      reserve: async () => ({ allowed: true, id: 1 }),
      settle,
    };
    const err = new AiUnavailableError("all_failed", [
      { provider: "gemini", model: "m", kind: "rate_limit" },
      { provider: "groq", model: "m", kind: "timeout" },
    ]);
    await ask("q?", {
      config: readAiConfig({ AI_ENABLED: "true", GROQ_API_KEYS: "k" }),
      usage,
      loadFacts: async () => FACTS,
      generate: async () => {
        throw err;
      },
    });
    expect(settle).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: "error",
        errorKind: "timeout",
        attempts: 2,
        rateLimited: 1,
        fallbacks: 1,
      }),
    );
    expect(JSON.stringify(settle.mock.calls)).not.toMatch(/secret/i);
  });
});
