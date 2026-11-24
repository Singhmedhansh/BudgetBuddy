import { describe, expect, it } from "vitest";
import { ask, type UsageStore } from "./assistant";
import { readAiConfig } from "./config";
import type { Facts } from "./grounding";
import { SentenceVerifier } from "./stream";

const facts: Facts = {
  asOf: "2026-11-22",
  space: { name: "Home", currency: "INR", sample: false },
  netWorth: "20000.00",
  held: "125000.00",
  owed: "5000.00",
  accounts: [],
  thisMonth: {
    label: "November 2026",
    income: "60000.00",
    spending: "42000.00",
    net: "18000.00",
    keptPercent: 30,
  },
  topCategories: [],
  budgets: [],
};

function run(chunks: string[], f: Facts = facts) {
  const out: string[] = [];
  const v = new SentenceVerifier(f, (t) => out.push(t));
  for (const c of chunks) v.push(c);
  v.finish();
  return { out: out.join(""), pieces: out, tag: v.readTag };
}

describe("streaming with a figure check on every sentence", () => {
  it("releases whole sentences, never half of one", () => {
    const { pieces } = run([
      "[A] You spent ₹42,000.00 this mo",
      "nth. That is up",
      " a little. Watch Food.",
    ]);
    expect(pieces[0]).toBe("You spent ₹42,000.00 this month. ");
    expect(pieces.join("")).toBe(
      "You spent ₹42,000.00 this month. That is up a little. Watch Food.",
    );
  });

  it("never releases a figure about the person that is not in their records", () => {
    const { out } = run([
      "[A] You spent ₹42,000.00 this month. You spent ₹99,999.00 on travel. Keep going.",
    ]);
    expect(out).toContain("₹42,000.00");
    expect(out).not.toContain("99,999");
    expect(out).toContain("Keep going.");
  });

  it("holds the tag back and reads it even when split across chunks", () => {
    const { out, tag } = run([
      "[",
      "G",
      "] Compound interest earns interest on interest.",
    ]);
    expect(tag).toBe("G");
    expect(out).toBe("Compound interest earns interest on interest.");
  });

  it("lets a general answer quote a benchmark that does not address the person", () => {
    const { out } = run([
      "[G] Experts usually suggest 3 to 6 months of expenses. You should check your own.",
    ]);
    expect(out).toContain("3 to 6 months");
  });

  it("does not split a decimal or hold a list apart", () => {
    const { out } = run([
      "[G] The rate is about 7.1% a year.\n- first point\n- second point",
    ]);
    expect(out).toBe(
      "The rate is about 7.1% a year.\n- first point\n- second point",
    );
  });

  it("treats a reply with no tag as the strict records case", () => {
    const { out, tag } = run(["You spent ₹11,111.00 on food. Plan ahead."]);
    expect(tag).toBe("A");
    expect(out).not.toContain("11,111");
    expect(out).toContain("Plan ahead.");
  });
});

describe("ask() with a stream", () => {
  const usage: UsageStore = {
    reserve: async () => ({ allowed: true, id: 1 }),
    settle: async () => undefined,
  };
  const config = readAiConfig({
    GEMINI_API_KEYS: "k",
    GROQ_API_KEYS: "k",
    AI_ENABLED: "true",
  });
  const gen = (text: string) => async () => ({
    text,
    promptTokens: 10,
    completionTokens: 10,
    provider: "gemini",
    model: "m",
    attempts: 1,
    fallbacks: 0,
    rateLimited: 0,
  });

  it("streams checked sentences, then returns the same checked answer", async () => {
    const deltas: string[] = [];
    const status: string[] = [];
    const r = await ask("How much did I spend?", {
      config,
      usage,
      loadFacts: async () => facts,
      generate: gen(
        "[A] You spent ₹42,000.00 this month. You also spent ₹77,777.00 on gifts.",
      ),
      stream: { status: (s) => status.push(s), delta: (d) => deltas.push(d) },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(deltas.join("")).not.toContain("77,777");
    expect(r.answer).not.toContain("77,777");
    expect(r.answer).toContain("₹42,000.00");
    expect(status).toContain("Reading your records");
  });

  it("uses figures from an attached document, and only those", async () => {
    const r = await ask("What is the total on this slip?", {
      config,
      usage,
      loadFacts: async () => facts,
      document: { name: "slip.txt", text: "Net salary 83,250.00 credited" },
      generate: gen(
        "[A] From your document: net salary is 83,250.00. Tax was 12,345.00.",
      ),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer).toContain("83,250.00");
    expect(r.answer).not.toContain("12,345.00");
    expect(r.visuals ?? []).toEqual([]);
  });
});
