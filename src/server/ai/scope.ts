import { detectCalculation } from "./calculators";
import { targetAmount, type Facts } from "./grounding";

/**
 * What a question needs from the person's records, decided in code before anything is sent to a model.
 *
 * Free model quotas are counted in tokens, and most of a question's tokens are the person's figures. So a question that
 * needs none of them sends none, and a question about bills sends bills rather than six months of everything. Capacity
 * goes up several times over, answers come back sooner, and a general answer contains nothing private, which also makes
 * it safe to share between people (see answer-cache.ts).
 */

/** Words that make a question about the person: I, me, my, we, our. */
const FIRST = /\b(i|i'm|i've|i'll|i'd|me|my|mine|myself|we|our|ours)\b/i;

/** Subjects that are about their own records even when the question never says "my". */
const PERSONAL_TOPIC =
  /\b(bills?|due|upcoming|subscriptions?|budgets?|goals?|spen[dt]|spending|expenses?|net worth|balance|accounts?|transactions?|payees?|merchants?|statement|income|salary|paycheck|where did)\b/i;

/**
 * True when nothing in the question, or in the conversation so far, is about the person's own money. Such a question is
 * answered without loading or sending any records. A named calculation ("EMI on 5 lakh at 10% for 3 years") is general;
 * "how many months to save for 10K" is not, because the answer depends on their savings.
 */
export function isGeneralQuestion(question: string, earlier = ""): boolean {
  const text = `${question} ${earlier}`;
  if (FIRST.test(text) || PERSONAL_TOPIC.test(text)) return false;
  if (detectCalculation(question)) return true;
  return targetAmount(question) === null;
}

/** The person's own earlier questions in this chat, which keep a follow-up ("and last month?") personal. */
export function earlierText(
  history: { role: string; content: string }[],
): string {
  return history
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content.slice(0, 300))
    .join(" ");
}

const TOPICS: Record<string, RegExp> = {
  spend:
    /spen[dt]|expens|categor|payee|merchant|where did|biggest|largest|\bcut\b|reduce|trend|compare|income|earn|salary|last month|history|over time|\brate\b|saving|cost|bought|purchase/i,
  pace: /per day|a day|daily|pace|on track|end of (the )?month|projected|forecast|so far|this month|rest of the month|faster|slower|usual/i,
  budget: /budget|\blimit\b|\bover\b|overspen/i,
  bills:
    /\bbills?\b|\bdue\b|upcoming|subscription|recurring|\brent\b|\bemi\b|renew/i,
  goals: /\bgoals?\b|target|\btrip\b/i,
  debts:
    /\bdebts?\b|\bloans?\b|\bowe\b|credit card|borrow|interest|\bemi\b|mortgage|pay ?off/i,
  cushion:
    /emergency|cushion|runway|50\/30\/20|months of|live on|afford|how long|save for|\bbuy\b|purchase|invest/i,
  worth:
    /net worth|worth|balance|account|\bbank\b|\bcash\b|how much (do|did) i have|have in/i,
};

/** Facts that every personal answer keeps. */
const KEEP_ALWAYS: (keyof Facts)[] = [
  "asOf",
  "space",
  "region",
  "netWorth",
  "held",
  "owed",
  "thisMonth",
  "topCategories",
  "monthlyNet",
  "savingsPlan",
  "calculation",
  "scenario",
  "reference",
  "document",
];

const SECTIONS: Record<string, (keyof Facts)[]> = {
  spend: ["categories", "payees", "history"],
  pace: ["pace", "budgets"],
  budget: ["budgets", "pace", "categories"],
  bills: ["bills", "subscriptions"],
  goals: ["goals"],
  debts: ["debts", "accounts"],
  cushion: ["emergencyFund", "rule503020", "spendable", "pace", "history"],
  worth: ["accounts", "spendable"],
};

/**
 * The part of the person's facts a personal question needs. When the question names no topic we recognise, everything
 * is kept: a wrong guess here would only make an answer worse, never unsafe, so the default is to keep it all. Every
 * number the model may quote must be in what it was shown, so a smaller set of facts is also a stricter check.
 */
export function pruneFacts(
  facts: Facts,
  question: string,
  earlier = "",
): Facts {
  const text = `${question} ${earlier}`;
  const wanted = Object.entries(TOPICS)
    .filter(([, re]) => re.test(text))
    .flatMap(([name]) => SECTIONS[name]);
  if (wanted.length === 0) return facts;
  const keep = new Set<keyof Facts>([...KEEP_ALWAYS, ...wanted]);
  const out: Record<string, unknown> = {
    accounts: [],
    budgets: [],
  };
  for (const [k, v] of Object.entries(facts))
    if (keep.has(k as keyof Facts)) out[k] = v;
  return out as unknown as Facts;
}

/** A question reduced to what decides the answer, so the same question asked twice looks the same. */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%.\s]/gu, " ")
    .replace(/\.(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Facts with nothing in them, used only to check a general answer. The model never sees these. */
export function emptyFacts(
  region: { country: string | null; currency: string },
  asOf: string,
): Facts {
  return {
    asOf,
    space: { name: "", currency: region.currency, sample: false },
    netWorth: "0.00",
    held: "0.00",
    owed: "0.00",
    accounts: [],
    thisMonth: {
      label: "",
      income: "0.00",
      spending: "0.00",
      net: "0.00",
      keptPercent: null,
    },
    topCategories: [],
    budgets: [],
    region,
  };
}
