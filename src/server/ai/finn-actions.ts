import { randomUUID } from "node:crypto";
import { toDecimalString } from "@/domain/money";
import { localDate } from "@/domain/period";
import type { requireSpace } from "@/server/context";
import { listAccounts, listBudgets, listCategories } from "@/server/queries";
import type { FinnAction, Visual } from "./visuals";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

const SUFFIX: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  l: 1e5,
  lac: 1e5,
  lakh: 1e5,
  lakhs: 1e5,
  m: 1e6,
  million: 1e6,
  cr: 1e7,
  crore: 1e7,
};

/** The first amount in a sentence ("450", "1.5k", "2 lakh"), or null. Used only to read what the person asks to record. */
export function actionAmount(text: string): number | null {
  for (const m of text.matchAll(
    /(\d[\d,]*(?:\.\d+)?)\s*(thousand|lakhs?|lac|crore|million|cr|k|l|m)?(?![a-z0-9])/gi,
  )) {
    const v =
      Number(m[1].replace(/,/g, "")) *
      (m[2] ? (SUFFIX[m[2].toLowerCase()] ?? 1) : 1);
    if (Number.isFinite(v) && v > 0 && v <= 1e9)
      return Math.round(v * 100) / 100;
  }
  return null;
}

/** Words that point at a category name when the name itself is not in the sentence. */
const HINTS: [RegExp, RegExp][] = [
  [/grocer|vegetable|supermarket|kirana|milk/, /grocer|food/],
  [
    /lunch|dinner|breakfast|restaurant|cafe|coffee|swiggy|zomato|eat|snack|meal/,
    /food|dining|restaurant|eating/,
  ],
  [
    /uber|ola|cab|taxi|petrol|diesel|fuel|metro|bus|auto|train/,
    /transport|travel|fuel|commute/,
  ],
  [/movie|netflix|spotify|game|concert/, /entertain|fun|leisure|subscri/],
  [/electric|water bill|gas|internet|wifi|phone|recharge|bill/, /bill|utilit/],
  [/rent|landlord/, /rent|housing/],
  [/doctor|medicine|pharmacy|hospital|clinic/, /health|medic/],
  [/salary|paycheck|payday|stipend/, /salary|income|pay/],
  [/shirt|shoes|amazon|flipkart|clothes|shopping/, /shop|cloth/],
];

export function pickCategory<T extends { id: string; name: string }>(
  q: string,
  cats: T[],
): T | null {
  const lower = q.toLowerCase();
  const byName = cats
    .filter((c) => lower.includes(c.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (byName) return byName;
  for (const [word, nameHint] of HINTS)
    if (word.test(lower)) {
      for (const part of nameHint.source.split("|")) {
        const one = new RegExp(part);
        const hit = cats.find((c) => one.test(c.name.toLowerCase()));
        if (hit) return hit;
      }
    }
  return null;
}

/** True when a message reads as a request to change something (so it is handled as a proposal, not sent to the model). */
export function looksLikeAction(question: string): boolean {
  const q = question.trim();
  if (q.endsWith("?")) return false;
  return (SET_LIMIT.test(q) && /\b(budget|limit)\b/i.test(q)) || ADD.test(q);
}

export interface Proposal {
  text: string;
  visuals: Visual[];
}

const ADD =
  /^\s*(?:please\s+|pls\s+)?(?:(?:can|could|would) you\s+)?(?:just\s+)?(add|log|record|enter|note|save|put|create)\b|\bi\s+(?:just\s+)?(spent|paid|bought|received|earned|got paid)\b/i;
const SET_LIMIT =
  /\b(set|change|make|update|raise|lower|increase|reduce)\b[^?]*\b(budget|limit)\b/i;

/**
 * Turns a plain request ("add a 450 grocery expense", "set my Food budget to 6000") into a proposal for the person to
 * confirm, using their own accounts, categories and budgets. No model is involved, so nothing can be made up: if a
 * detail is unclear Finn says what it needs. Returns null when the message is not a request to change something.
 */
export async function proposeAction(
  question: string,
  ctx: Ctx,
  now = new Date(),
): Promise<Proposal | null> {
  const q = question.trim();
  if (q.endsWith("?")) return null;
  const cur = ctx.space.currency;
  const fmt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: 2,
  });

  if (SET_LIMIT.test(q) && /\b(budget|limit)\b/i.test(q)) {
    const amount = actionAmount(q);
    const [budgets, cats] = await Promise.all([
      listBudgets(ctx),
      listCategories(ctx, "expense"),
    ]);
    const cat = pickCategory(q, cats);
    if (!amount || !cat)
      return {
        text: "Tell me the category and the amount, for example: set my Food budget to 6,000.",
        visuals: [],
      };
    const budget =
      budgets.find((b) => b.lines.some((l) => l.categoryId === cat.id)) ??
      budgets[0];
    if (!budget)
      return {
        text: "You do not have a budget yet. Create one in Budgets first, then I can change its limits for you.",
        visuals: [],
      };
    const prev = budget.lines.find((l) => l.categoryId === cat.id);
    const action: FinnAction = {
      kind: "set_budget_limit",
      budgetId: budget.id,
      budgetName: budget.name,
      categoryId: cat.id,
      categoryName: cat.name,
      amount,
      amountDisplay: fmt.format(amount),
      previousDisplay: prev
        ? fmt.format(
            Number(toDecimalString(prev.status.allocated - prev.carried, cur)),
          )
        : null,
    };
    return {
      text: `Here is the change I will make to your budget. Confirm and it is saved.`,
      visuals: [{ type: "action", action }],
    };
  }

  const m = ADD.exec(q);
  if (!m) return null;
  const amount = actionAmount(q);
  if (!amount)
    return {
      text: "How much was it? For example: add a 450 grocery expense.",
      visuals: [],
    };
  const income =
    /\b(received|earned|salary|income|got paid|credited|stipend|refund|bonus)\b/i.test(
      q,
    );
  const [accounts, cats] = await Promise.all([
    listAccounts(ctx),
    listCategories(ctx, income ? "income" : "expense"),
  ]);
  const cat = pickCategory(q, cats);
  if (!cat) {
    const names = cats
      .slice(0, 8)
      .map((c) => c.name)
      .join(", ");
    return {
      text: `Which category is this for? You have: ${names || "no categories yet"}. For example: add ${fmt.format(amount)} for ${cats[0]?.name ?? "Food"}.`,
      visuals: [],
    };
  }
  const mentioned = accounts.find((a) =>
    q.toLowerCase().includes(a.name.toLowerCase()),
  );
  const spendable = accounts.find((a) =>
    ["current", "savings", "cash", "wallet"].includes(a.type),
  );
  const account = mentioned ?? spendable ?? accounts[0];
  if (!account)
    return {
      text: "You need an account before I can record this. Add one in Accounts.",
      visuals: [],
    };
  const t = localDate(now, ctx.profile.timezone);
  const day = new Date(
    Date.UTC(t.year, t.month - 1, t.day - (/\byesterday\b/i.test(q) ? 1 : 0)),
  );
  const date = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
  const merchant =
    /\b(?:at|from|to)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,2})/.exec(
      q,
    )?.[1] ?? null;
  const action: FinnAction = {
    kind: "add_transaction",
    type: income ? "income" : "expense",
    amount,
    amountDisplay: fmt.format(amount),
    accountId: account.id,
    accountName: account.name,
    categoryId: cat.id,
    categoryName: cat.name,
    date,
    merchant,
    clientKey: randomUUID(),
  };
  return {
    text: `Here is what I will record${mentioned ? "" : ` (from ${account.name}, your main account)`}. Confirm and it is saved.`,
    visuals: [{ type: "action", action }],
  };
}
