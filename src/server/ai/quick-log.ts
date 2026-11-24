/**
 * Reading "400 on food", "swiggy 250", "200 auto, 150 chai yesterday" or "got 50k salary" as money to record, in code.
 * No model is involved, so it costs nothing, answers instantly and cannot invent an amount: every amount returned is
 * written in the message. Anything that does not clearly read as a record returns null and is answered as a question.
 */

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

const AMOUNT =
  /(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(thousand|lakhs?|lac|crore|million|cr|k|l|m)?(?:\s*(?:rs|rupees?|bucks|inr|₹))?(?![a-z0-9])/i;

/** Words that make a message a request to record money, wherever they appear. */
const VERB =
  /\b(add|log|record|note|enter|spent|spend|spending|paid|pay|bought|buy|gave|received|got|earned|credited|debited|transferred|sent)\b/i;
/** Words that make it money coming in. */
const INCOME =
  /\b(received|earned|got paid|credited|salary|stipend|income|allowance|pocket money|refund|cashback|bonus|freelance|interest|dividend)\b/i;
/** Words that mean the message is a question or a statement about money, not one to record. */
const QUESTION_START =
  /^\s*(what|how|why|when|where|which|who|can|could|should|would|will|is|are|am|do|does|did|was|were|tell|show|explain|compare|help)\b/i;
const NOT_A_RECORD =
  /\b(have|had|left|balance|budget|limit|goal|need|want|plan|afford|owe|every month|per month|monthly|each month|a month|average|usually|total)\b/i;

/** Words of intent: a message with these is about a plan or a wish, not something that happened. */
const PLAN_WORDS =
  /\b(want|wanna|need|plan|planning|hoping|hope|goal|target|afford|should|could|would|if|save up|saving up)\b/i;

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1e3,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  crore: 1e7,
};

/** "four hundred fifty" becomes "450", so a message spoken into the mic reads the same as one typed. */
export function numberWordsToDigits(text: string): string {
  const words = Object.keys(UNITS).concat(Object.keys(SCALES)).join("|");
  const run = new RegExp(
    `\\b(?:${words})(?:[\\s-]+(?:and[\\s-]+)?(?:${words}))*\\b`,
    "gi",
  );
  return text.replace(run, (match) => {
    let total = 0;
    let current = 0;
    for (const w of match.toLowerCase().split(/[\s-]+/)) {
      if (w === "and") continue;
      if (w in UNITS) current += UNITS[w];
      else if (w === "hundred") current = (current || 1) * 100;
      else if (w in SCALES) {
        total += (current || 1) * SCALES[w];
        current = 0;
      }
    }
    const n = total + current;
    // "one" or "a ... one" on its own is usually a word, not an amount.
    return n === 1 && !/\d/.test(match) ? match : String(n);
  });
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

export interface Day {
  year: number;
  month: number;
  day: number;
}
const iso = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/**
 * The date a message names (today, yesterday, "day before yesterday", "on Monday", "last Friday", "12 Nov", "Nov 12"),
 * and the message with that phrase taken out. Never a future date: "12 Dec" said in November means last December.
 */
export function readDate(
  text: string,
  today: Day,
): { date: string; rest: string } {
  const base = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const shift = (days: number) =>
    iso(new Date(base.getTime() - days * 86_400_000));
  const cut = (re: RegExp | string) =>
    text.replace(re, " ").replace(/\s+/g, " ").trim();

  let m = /\b(?:the\s+)?day before yesterday\b/i.exec(text);
  if (m) return { date: shift(2), rest: cut(m[0]) };
  m = /\byesterday\b/i.exec(text);
  if (m) return { date: shift(1), rest: cut(/\byesterday\b/i) };
  m =
    /\b(?:on\s+)?(last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(
      text,
    );
  if (m) {
    const want = WEEKDAYS.indexOf(m[2].toLowerCase());
    let back = (base.getUTCDay() - want + 7) % 7;
    if (m[1] && back === 0) back = 7;
    return { date: shift(back), rest: cut(new RegExp(escape(m[0]), "i")) };
  }
  const monthRe = MONTHS.join("|");
  m = new RegExp(
    `\\b(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthRe})[a-z]*\\b|\\b(?:on\\s+)?(${monthRe})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    "i",
  ).exec(text);
  if (m) {
    const day = Number(m[1] ?? m[4]);
    const month = MONTHS.indexOf((m[2] ?? m[3]).toLowerCase().slice(0, 3));
    let d = new Date(Date.UTC(today.year, month, day));
    if (d.getUTCMonth() !== month)
      return { date: iso(base), rest: text.trim() };
    if (d > base) d = new Date(Date.UTC(today.year - 1, month, day));
    return { date: iso(d), rest: cut(new RegExp(escape(m[0]), "i")) };
  }
  return {
    date: iso(base),
    rest: text
      .replace(/\btoday\b/i, " ")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface QuickItem {
  type: "expense" | "income";
  amount: number;
  /** The words that came with this amount, used to find the category, account and merchant. */
  text: string;
}

export interface QuickLog {
  items: QuickItem[];
  date: string;
  /** True when the message says to record it ("add", "spent", "paid"...); false for bare forms like "food 400". */
  explicit: boolean;
}

function amountOf(segment: string): { amount: number; at: number } | null {
  const m = AMOUNT.exec(segment);
  if (!m) return null;
  const v =
    Number(m[1].replace(/,/g, "")) *
    (m[2] ? (SUFFIX[m[2].toLowerCase()] ?? 1) : 1);
  if (!Number.isFinite(v) || v <= 0 || v > 1e9) return null;
  return { amount: Math.round(v * 100) / 100, at: m.index };
}

/**
 * The money a message asks to record, or null when it is a question or a statement. Several amounts separated by commas,
 * "and" or new lines become several items; words without an amount stay with the item before them.
 */
export function parseQuickLog(message: string, today: Day): QuickLog | null {
  const raw = message.trim();
  if (!raw || raw.length > 400 || raw.endsWith("?")) return null;
  const explicit = VERB.test(raw);
  if (QUESTION_START.test(raw) && !/^\s*(add|log|record)\b/i.test(raw))
    return null;
  if (!explicit && NOT_A_RECORD.test(raw)) return null;
  // Wishes and plans ("I want to save 7000") are never records, unless the message starts by asking to record.
  if (PLAN_WORDS.test(raw) && !/^\s*(add|log|record|note|enter)\b/i.test(raw))
    return null;
  // Percentages and ranges are not records ("cut food by 20%").
  if (/%|\bper\s*cent\b/i.test(raw)) return null;

  const { date, rest } = readDate(numberWordsToDigits(raw), today);
  const parts = rest
    // A comma straight before a digit belongs to the number ("1,200"), so only other commas separate entries.
    .split(/\s*(?:,(?!\d)|;|\n|\+|\band\b|&)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const items: QuickItem[] = [];
  for (const p of parts) {
    const a = amountOf(p);
    if (a)
      items.push({
        type:
          INCOME.test(p) || (parts.length === 1 && INCOME.test(rest))
            ? "income"
            : "expense",
        amount: a.amount,
        text: p,
      });
    else if (items.length) items[items.length - 1].text += ` ${p}`;
    else if (parts.length > 1) {
      // Words before the first amount ("spent on food: 400") belong to it.
      parts[parts.indexOf(p) + 1] = `${p} ${parts[parts.indexOf(p) + 1]}`;
    }
  }
  if (items.length === 0 || items.length > 8) return null;
  // A bare message must be short and made of amounts with a word or two each, so a sentence is never mistaken for a record.
  if (!explicit && items.some((i) => i.text.split(/\s+/).length > 6))
    return null;
  return { items, date, explicit };
}
