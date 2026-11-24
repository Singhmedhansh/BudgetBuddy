import { describe, expect, it, vi } from "vitest";
import { detectCalculation } from "./calculators";
import { cacheKey, type AnswerCache } from "./answer-cache";
import { ask, MESSAGES, type UsageStore } from "./assistant";
import { readAiConfig } from "./config";
import { CASES } from "./eval/cases";
import { statedFigures, type Facts } from "./grounding";
import { AiUnavailableError, generate } from "./router";
import { ProviderError, type ProviderClient } from "./types";
import {
  emptyFacts,
  isGeneralQuestion,
  normalizeQuestion,
  pruneFacts,
} from "./scope";
import { buildVisuals } from "./visuals";

const region = { country: "IN", currency: "INR" };

const rich: Facts = {
  asOf: "2026-11-22",
  space: { name: "Asha's private space", currency: "INR", sample: false },
  netWorth: "20000.00",
  held: "125000.00",
  owed: "5000.00",
  accounts: [{ name: "HDFC Savings", type: "Savings", balance: "95000.00" }],
  thisMonth: {
    label: "November 2026",
    income: "60000.00",
    spending: "42000.00",
    net: "18000.00",
    keptPercent: 30,
  },
  topCategories: [{ name: "Rent", amount: "15000.00", percent: 36 }],
  categories: [
    {
      name: "Food",
      thisMonth: "9000.00",
      lastMonth: "5600.00",
      changePercent: 61,
      avg3m: "5200.00",
    },
  ],
  payees: [
    {
      name: "Swiggy",
      thisMonth: "3000.00",
      last90Days: "8000.00",
      visits90: 12,
    },
  ],
  history: [
    {
      label: "Oct 2026",
      income: "60000.00",
      spending: "40000.00",
      net: "20000.00",
    },
  ],
  bills: [
    {
      name: "Rent",
      kind: "bill",
      amount: "15000.00",
      due: "2026-12-01",
      state: "upcoming",
    },
  ],
  goals: [
    {
      name: "Trip",
      target: "50000.00",
      saved: "21000.00",
      remaining: "29000.00",
      deadline: null,
      monthlyNeeded: null,
      health: "on track",
    },
  ],
  debts: [
    { name: "Card", owed: "5000.00", ratePercent: 36, minPayment: "500.00" },
  ],
  budgets: [],
};

describe("which questions need the person's records", () => {
  it("treats the general-knowledge cases in the saved set as general, and their own-number cases as personal", () => {
    const general = [
      "What is an emergency fund?",
      "Explain compound interest simply",
      "What is the difference between a debit card and a credit card?",
      "How does a credit score work?",
      "What is inflation and why does it matter?",
      "What does term insurance cover?",
      "What is the 4% rule for retirement?",
      "What is a mutual fund?",
      "What is the snowball method for debt?",
      "What is an index fund?",
      "How does UPI work?",
      "What is the current PPF interest rate?",
      "What would the EMI be on a 5 lakh loan at 10% for 3 years?",
    ];
    for (const q of general) expect(isGeneralQuestion(q), q).toBe(true);
    const personal = CASES.filter(
      (c) => c.visuals && !c.calc && !c.reference,
    ).map((c) => c.q);
    expect(personal.length).toBeGreaterThan(10);
    for (const q of personal) expect(isGeneralQuestion(q), q).toBe(false);
    for (const q of [
      "How many months to save for a 10K purchase?",
      "What bills are coming up?",
      "Should I pay off my loan or invest?",
    ])
      expect(isGeneralQuestion(q), q).toBe(false);
  });
  it("keeps a follow-up personal when the question before it was", () => {
    expect(
      isGeneralQuestion("and last month?", "How much did I spend on food?"),
    ).toBe(false);
  });
  it("draws a calculation the same whether or not records were loaded", () => {
    const q = "What would the EMI be on a 5 lakh loan at 10% for 3 years?";
    const shell = emptyFacts(region, "2026-11-23");
    const calc = detectCalculation(q)!;
    expect(
      buildVisuals(q, { ...shell, calculation: calc }).map((v) => v.type),
    ).toEqual(["stats", "donut", "line"]);
  });
});

describe("sending only what a question needs", () => {
  it("keeps the bills for a bills question and drops the rest", () => {
    const f = pruneFacts(rich, "What bills are coming up?");
    expect(f.bills).toBeDefined();
    expect(f.payees).toBeUndefined();
    expect(f.history).toBeUndefined();
    expect(f.goals).toBeUndefined();
    expect(f.thisMonth).toBeDefined();
  });
  it("keeps spending detail for a spending question", () => {
    const f = pruneFacts(rich, "Why did I spend more on Food?");
    expect(f.categories).toBeDefined();
    expect(f.payees).toBeDefined();
    expect(f.bills).toBeUndefined();
  });
  it("keeps everything when it cannot tell what is needed", () => {
    expect(pruneFacts(rich, "Hmm, what do you think of my situation?")).toBe(
      rich,
    );
  });
  it("sends far fewer characters for a focused question", () => {
    const full = JSON.stringify(rich).length;
    expect(
      JSON.stringify(pruneFacts(rich, "What bills are coming up?")).length,
    ).toBeLessThan(full * 0.7);
  });
});

describe("answering a general question", () => {
  const config = readAiConfig({
    GEMINI_API_KEYS: "k",
    GROQ_API_KEYS: "k",
    AI_ENABLED: "true",
  });
  const usage = (): UsageStore => ({
    reserve: vi.fn(async () => ({ allowed: true as const, id: 1 })),
    settle: vi.fn(async () => undefined),
  });
  const reply = (text: string) =>
    vi.fn(async () => ({
      text,
      promptTokens: 10,
      completionTokens: 10,
      provider: "groq",
      model: "m",
      attempts: 1,
      fallbacks: 0,
      rateLimited: 0,
    }));
  const memory = (): AnswerCache & { store: Map<string, string> } => {
    const store = new Map<string, string>();
    return {
      store,
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => void store.set(k, v),
    };
  };

  it("loads none of their records and puts none in the prompt", async () => {
    const loadFacts = vi.fn(async () => rich);
    const generate = reply(
      "[G] An emergency fund is money set aside for surprises. Aim for a few months of expenses.",
    );
    const r = await ask("What is an emergency fund?", {
      config,
      usage: usage(),
      loadFacts,
      generate,
      region,
    });
    expect(r.ok).toBe(true);
    expect(loadFacts).not.toHaveBeenCalled();
    const req = (
      generate.mock.calls[0] as unknown as [
        unknown,
        { system: string; tier?: string },
      ]
    )[1];
    expect(req.system).not.toContain("Asha");
    expect(req.system).not.toContain("HDFC");
    expect(req.tier).toBe("light");
  });

  it("stores a clean answer, then serves it to the next person without a model call or an allowance", async () => {
    const cache = memory();
    const first = reply(
      "[G] An emergency fund is money set aside for surprises. Aim for a few months of expenses.",
    );
    const u1 = usage();
    await ask("What is an emergency fund?", {
      config,
      usage: u1,
      loadFacts: async () => rich,
      generate: first,
      region,
      answerCache: cache,
    });
    expect(cache.store.size).toBe(1);

    const second = reply("[G] should not be used");
    const u2 = usage();
    const r = await ask("what is an emergency fund", {
      config,
      usage: u2,
      loadFacts: async () => rich,
      generate: second,
      region,
      answerCache: cache,
    });
    expect(r).toMatchObject({ ok: true, source: "general" });
    expect(r.ok && r.answer).toContain("set aside for surprises");
    expect(second).not.toHaveBeenCalled();
    expect(u2.reserve).not.toHaveBeenCalled();
  });

  it("never stores an answer to a personal question, or one with a sentence removed", async () => {
    const cache = memory();
    await ask("How much did I spend this month?", {
      config,
      usage: usage(),
      loadFacts: async () => rich,
      region,
      answerCache: cache,
      generate: reply("[G] You spent about money."),
    });
    expect(cache.store.size).toBe(0);
    await ask("What is a good savings rate?", {
      config,
      usage: usage(),
      loadFacts: async () => rich,
      region,
      answerCache: cache,
      generate: reply(
        "[G] Many people aim for 20 percent of income. You should save ₹99,999 a month.",
      ),
    });
    expect(cache.store.size).toBe(0);
  });

  it("does not use the shared cache inside a conversation", async () => {
    const cache = memory();
    const g = reply(
      "[G] A mutual fund pools money from many people to invest together.",
    );
    await ask(
      "What is a mutual fund?",
      {
        config,
        usage: usage(),
        loadFacts: async () => rich,
        generate: g,
        region,
        answerCache: cache,
      },
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    );
    expect(cache.store.size).toBe(0);
  });

  it("keys the same question the same way whatever the punctuation, and differently by country", () => {
    expect(normalizeQuestion("What is an Emergency Fund?!")).toBe(
      "what is an emergency fund",
    );
    expect(cacheKey("What is an emergency fund?", region, false)).toBe(
      cacheKey("what is an emergency fund", region, false),
    );
    expect(cacheKey("what is an emergency fund", region, false)).not.toBe(
      cacheKey(
        "what is an emergency fund",
        { country: "US", currency: "USD" },
        false,
      ),
    );
    expect(cacheKey("what is an emergency fund", region, false)).not.toBe(
      cacheKey("what is an emergency fund", region, true),
    );
  });
});

describe("when every free provider is out of quota", () => {
  it("says Finn is busy and does not count the question", async () => {
    const settle = vi.fn(async () => undefined);
    const config = readAiConfig({
      GEMINI_API_KEYS: "k",
      GROQ_API_KEYS: "k",
      AI_ENABLED: "true",
    });
    const r = await ask("How much did I spend?", {
      config,
      usage: { reserve: async () => ({ allowed: true, id: 5 }), settle },
      loadFacts: async () => rich,
      generate: async () => {
        throw new AiUnavailableError("all_failed", [
          { provider: "groq", model: "m", kind: "rate_limit" },
          { provider: "gemini", model: "m", kind: "rate_limit" },
        ]);
      },
    });
    expect(r).toMatchObject({
      ok: false,
      reason: "busy",
      message: MESSAGES.busy,
    });
    expect(settle).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ status: "error" }),
    );
  });
});

describe("figures the person types themselves", () => {
  const config = readAiConfig({
    GEMINI_API_KEYS: "k",
    GROQ_API_KEYS: "k",
    AI_ENABLED: "true",
  });
  const usage = (): UsageStore => ({
    reserve: vi.fn(async () => ({ allowed: true as const, id: 1 })),
    settle: vi.fn(async () => undefined),
  });
  const reply = (text: string) =>
    vi.fn(async () => ({
      text,
      promptTokens: 10,
      completionTokens: 10,
      provider: "groq",
      model: "m",
      attempts: 1,
      fallbacks: 0,
      rateLimited: 0,
    }));

  it("reads amounts with K and lakh, and skips list numbers", () => {
    expect(
      statedFigures(
        "I have 569 in my bank and 1000 in cash, 5K coming and 1.5 lakh saved",
      ),
    ).toEqual({
      amounts: ["569.00", "1000.00", "5000.00", "150000.00"],
      totalOfThisMessage: "156569.00",
    });
    expect(
      statedFigures("1. Flights 4500 2. Hotel 3000 3. Car Rental - 560")
        ?.amounts,
    ).toEqual(["4500.00", "3000.00", "560.00"]);
    expect(statedFigures("How am I doing?")).toBeUndefined();
  });

  it("lets an answer repeat what they said instead of replacing it with a records summary", async () => {
    const r = await ask(
      "Currently I have 569 in my bank and 1000 in cash, I will get an allowance of 5K externally",
      {
        config,
        usage: usage(),
        loadFacts: async () => rich,
        region,
        generate: reply(
          "[A] You mentioned ₹569 in the bank, ₹1,000 in cash and ₹5,000 coming, so ₹6,569 to plan with. Tell me your trip costs and I will split it.",
        ),
      },
    );
    expect(r).toMatchObject({ ok: true, source: "model" });
    expect(r.ok && r.answer).toContain("6,569");
    expect(r.ok && r.answer).not.toContain("As of");
  });

  it("still removes a figure that neither the records nor the person gave", async () => {
    const r = await ask("I have 569 in my bank", {
      config,
      usage: usage(),
      loadFacts: async () => rich,
      region,
      generate: reply(
        "[A] You mentioned ₹569 in the bank. You will have ₹88,888 left by December.",
      ),
    });
    expect(r.ok && r.answer).toContain("569");
    expect(r.ok && r.answer).not.toContain("88,888");
  });

  it("explains itself when nothing usable remains", async () => {
    const r = await ask("I have 569 in my bank", {
      config,
      usage: usage(),
      loadFacts: async () => rich,
      region,
      generate: reply("[A] You will have ₹88,888 left."),
    });
    expect(r).toMatchObject({ ok: true, source: "figures" });
    expect(r.ok && r.answer).toMatch(/could not turn those figures/);
  });
});

describe("OpenRouter as a free last fallback", () => {
  const keys = {
    GEMINI_API_KEYS: "g",
    GROQ_API_KEYS: "q",
    OPENROUTER_API_KEY_1: "o",
    AI_ENABLED: "true",
  };
  it("is read last, defaults to the free router and is limited to general questions", () => {
    const c = readAiConfig(keys);
    expect(c.providers.map((p) => p.id)).toEqual([
      "gemini",
      "groq",
      "openrouter",
    ]);
    const o = c.providers.at(-1)!;
    expect(o.model).toBe("openrouter/free");
    expect(o.generalOnly).toBe(true);
    expect(
      readAiConfig({ ...keys, OPENROUTER_ALLOW_PERSONAL: "true" }).providers.at(
        -1,
      )!.generalOnly,
    ).toBe(false);
  });

  const fakeClient = (id: "gemini" | "groq" | "openrouter", fails: boolean) => {
    const complete = vi.fn(async () => {
      if (fails) throw new ProviderError("rate_limit");
      return { text: `from ${id}`, promptTokens: 1, completionTokens: 1 };
    });
    return { id, complete } as ProviderClient & { complete: typeof complete };
  };
  const clients = (openOk: boolean) => ({
    gemini: fakeClient("gemini", true),
    groq: fakeClient("groq", true),
    openrouter: fakeClient("openrouter", !openOk),
  });
  const req = (general?: boolean) => ({
    system: "s",
    messages: [{ role: "user" as const, content: "q" }],
    maxOutputTokens: 50,
    ...(general ? { general: true } : {}),
  });

  it("answers a general question when the others are out of quota", async () => {
    const c = clients(true);
    const r = await generate(readAiConfig(keys), req(true), c);
    expect(r).toMatchObject({
      provider: "openrouter",
      model: "openrouter/free",
    });
  });

  it("is never sent a request built from the person's records", async () => {
    const c = clients(true);
    await expect(
      generate(readAiConfig(keys), req(false), c),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(c.openrouter.complete).not.toHaveBeenCalled();
  });
});
