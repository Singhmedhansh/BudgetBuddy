import { randomUUID } from "node:crypto";
import { toDecimalString } from "@/domain/money";
import { localDate } from "@/domain/period";
import type { requireSpace } from "@/server/context";
import { listAccounts, listBudgets, listCategories } from "@/server/queries";
import { parseQuickLog } from "./quick-log";
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
  [
    /grocer|vegetable|fruit|supermarket|kirana|milk|blinkit|zepto|instamart|bigbasket|dmart|jiomart|ration/,
    /grocer|food/,
  ],
  [
    /lunch|dinner|breakfast|restaurant|cafe|coffee|chai|tea|swiggy|zomato|eat|snack|meal|biryani|pizza|domino|mcdonald|kfc|starbucks|burger|juice|canteen|mess/,
    /food|dining|restaurant|eating/,
  ],
  [
    /uber|ola|rapido|cab|taxi|petrol|diesel|fuel|metro|bus|auto|rickshaw|train|irctc|flight|indigo|parking|toll|fastag/,
    /transport|travel|fuel|commute/,
  ],
  [
    /movie|netflix|prime video|hotstar|spotify|youtube premium|game|concert|pvr|inox|bookmyshow/,
    /entertain|fun|leisure|subscri/,
  ],
  [
    /electric|water bill|gas|internet|wifi|broadband|phone|recharge|jio|airtel|\bvi\b|dth|bill/,
    /bill|utilit/,
  ],
  [/rent|landlord|pg\b|hostel/, /rent|housing/],
  [
    /doctor|medicine|pharmacy|chemist|hospital|clinic|apollo|1mg|pharmeasy|netmeds|gym/,
    /health|medic|fitness/,
  ],
  [
    /fees|tuition|course|udemy|book|stationery|college|school/,
    /educat|study|school/,
  ],
  [/salary|paycheck|payday|stipend/, /salary|income|pay/],
  [/allowance|pocket money/, /allowance|pocket|income/],
  [/freelance|client/, /freelance|income/],
  [/refund|cashback/, /refund|cashback|income/],
  [
    /shirt|shoes|amazon|flipkart|myntra|ajio|meesho|nykaa|clothes|shopping/,
    /shop|cloth/,
  ],
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
  const words = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean));
  const byWord = cats.find((c) =>
    c.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((w) => w.length >= 4 && (words.has(w) || words.has(`${w}s`))),
  );
  if (byWord) return byWord;
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
export function looksLikeAction(question: string, now = new Date()): boolean {
  const q = question.trim();
  if (q.endsWith("?")) return false;
  const d = {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
  return (
    (SET_LIMIT.test(q) && /\b(budget|limit)\b/i.test(q)) ||
    parseQuickLog(q, d) !== null
  );
}

export interface Proposal {
  text: string;
  visuals: Visual[];
  /** True when every card is a transaction read from a quick record, so it may be saved at once if the person opted in. */
  quick?: boolean;
}

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

  const t = localDate(now, ctx.profile.timezone);
  const log = parseQuickLog(q, t);
  if (!log) return null;
  const [accounts, expenseCats, incomeCats] = await Promise.all([
    listAccounts(ctx),
    listCategories(ctx, "expense"),
    listCategories(ctx, "income"),
  ]);
  const resolved = log.items.map((item) => ({
    item,
    cat: pickCategory(
      item.text,
      item.type === "income" ? incomeCats : expenseCats,
    ),
  }));
  // "food 400" with no category we can match is not clearly a record: let Finn answer it instead.
  if (!log.explicit && resolved.some((r) => !r.cat)) return null;
  if (!accounts.length)
    return {
      text: "You need an account before I can record this. Add one in Accounts.",
      visuals: [],
    };
  const missing = resolved.filter((r) => !r.cat);
  if (missing.length) {
    const r = missing[0];
    const cats = r.item.type === "income" ? incomeCats : expenseCats;
    const names = cats
      .slice(0, 8)
      .map((c) => c.name)
      .join(", ");
    return {
      text: `Which category is ${fmt.format(r.item.amount)} for? You have: ${names || "no categories yet"}. For example: ${fmt.format(r.item.amount)} on ${cats[0]?.name ?? "Food"}.`,
      visuals: [],
    };
  }
  const visuals: Visual[] = resolved.map(({ item, cat }) => {
    const account = accountFor(`${item.text} ${q}`, accounts);
    const merchant =
      /\b(?:at|from|to)\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,2})/.exec(
        item.text,
      )?.[1] ?? knownMerchant(item.text);
    const action: FinnAction = {
      kind: "add_transaction",
      type: item.type,
      amount: item.amount,
      amountDisplay: fmt.format(item.amount),
      accountId: account.id,
      accountName: account.name,
      categoryId: cat!.id,
      categoryName: cat!.name,
      date: log.date,
      merchant,
      clientKey: randomUUID(),
    };
    return { type: "action", action };
  });
  return {
    text:
      visuals.length > 1
        ? `Here are the ${visuals.length} entries I will record. Confirm each one and it is saved.`
        : "Here is what I will record. Confirm and it is saved.",
    visuals,
    quick: true,
  };
}

type AccountRow = Awaited<ReturnType<typeof listAccounts>>[number];

/** The account a message points to: by its name, by how it was paid (cash, card, UPI), or the main everyday account. */
function accountFor(text: string, accounts: AccountRow[]): AccountRow {
  const lower = text.toLowerCase();
  const named = accounts.find((a) => lower.includes(a.name.toLowerCase()));
  if (named) return named;
  const byType = (types: string[]) =>
    accounts.find((a) => types.includes(a.type));
  if (/\bcash\b/.test(lower)) {
    const cash = byType(["cash"]);
    if (cash) return cash;
  }
  if (/\b(credit card|card)\b/.test(lower)) {
    const card = byType(["credit_card", "credit"]);
    if (card) return card;
  }
  if (/\b(paytm|wallet)\b/.test(lower)) {
    const wallet = byType(["wallet"]);
    if (wallet) return wallet;
  }
  return (
    byType(["current", "savings"]) ?? byType(["cash", "wallet"]) ?? accounts[0]
  );
}

const MERCHANTS = [
  "Swiggy",
  "Zomato",
  "Blinkit",
  "Zepto",
  "Instamart",
  "BigBasket",
  "DMart",
  "Uber",
  "Ola",
  "Rapido",
  "IRCTC",
  "Amazon",
  "Flipkart",
  "Myntra",
  "Ajio",
  "Meesho",
  "Nykaa",
  "Netflix",
  "Spotify",
  "Hotstar",
  "Jio",
  "Airtel",
  "Starbucks",
  "Dominos",
  "McDonald's",
  "KFC",
  "PVR",
  "BookMyShow",
  "Apollo",
  "PharmEasy",
];
function knownMerchant(text: string): string | null {
  const lower = text.toLowerCase().replace(/['’]/g, "");
  return (
    MERCHANTS.find((m) =>
      lower.includes(m.toLowerCase().replace(/['’]/g, "")),
    ) ?? null
  );
}
