import { stem, tokens } from "@/lib/text";
import { ARTICLES, DESTINATIONS, type Article, type Destination } from "./articles";

export interface SearchResult {
  articles: Article[];
  destinations: Destination[];
  /** A direct link that answers "where can I see X spending" style questions. */
  direct?: { label: string; href: string };
  /** Shown when nothing matched, so the user is never left with an empty page. */
  suggestions: string[];
}

const STOP = new Set([
  "a", "an", "the", "i", "my", "me", "to", "of", "in", "on", "for", "and", "or", "is", "are", "do", "does", "how", "what",
  "where", "can", "see", "show", "view", "find", "get", "with", "it", "this", "that", "at", "from", "by", "be", "have", "need",
]);

/** Words that mean "spending" in a question like "where can I see grocery spending". */
const SPEND_WORDS = new Set(["spend", "spending", "spent", "expense", "expenses", "cost", "costs"]);

const SUGGESTED_SEARCHES = ["add an account", "record an expense", "transfer between accounts", "create a budget", "reverse a transaction", "reset password"];

function score(article: Article, qs: string[]): number {
  const title = tokens(article.title).map(stem);
  const kw = article.keywords.flatMap(tokens).map(stem);
  const summary = tokens(article.summary).map(stem);
  const body = article.body.flatMap((b) => ("text" in b ? tokens(b.text) : b.items.flatMap(tokens))).map(stem);
  let total = 0;
  for (const q of qs) {
    if (title.includes(q)) total += 6;
    if (kw.includes(q)) total += 5;
    if (summary.includes(q)) total += 3;
    if (body.includes(q)) total += 1;
  }
  // Whole-phrase keyword hits (e.g. "credit card") are strong signals.
  return total;
}

export function searchHelp(query: string): SearchResult {
  const raw = query.trim().slice(0, 120);
  const qs = tokens(raw).filter((w) => !STOP.has(w)).map(stem);
  if (qs.length === 0) return { articles: [], destinations: [], suggestions: SUGGESTED_SEARCHES };

  const phrase = raw.toLowerCase();
  const articles = ARTICLES.map((a) => {
    let s = score(a, qs);
    for (const k of a.keywords) if (k.includes(" ") && phrase.includes(k)) s += 6;
    return { a, s };
  })
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.title.localeCompare(y.a.title))
    .slice(0, 6)
    .map((x) => x.a);

  const destinations = DESTINATIONS.map((d) => {
    const dk = d.keywords.flatMap(tokens).map(stem).concat(tokens(d.label).map(stem));
    return { d, s: qs.filter((q) => dk.includes(q)).length };
  })
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, 3)
    .map((x) => x.d);

  // "where can I see grocery spending" -> Transactions filtered to that category.
  let direct: SearchResult["direct"];
  const words = tokens(raw);
  if (words.some((w) => SPEND_WORDS.has(w))) {
    const subject = words.filter((w) => !STOP.has(w) && !SPEND_WORDS.has(w));
    if (subject.length > 0 && subject.length <= 3) {
      const cat = subject.join(" ");
      direct = { label: `See your ${cat} spending in Transactions`, href: `/app/transactions?cat=${encodeURIComponent(cat)}` };
    }
  }

  return { articles, destinations, direct, suggestions: articles.length || destinations.length || direct ? [] : SUGGESTED_SEARCHES };
}
