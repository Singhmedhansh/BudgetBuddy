import type { Facts } from "./grounding";

const n = (v: string | number | undefined) => Number(v ?? 0);
const money = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

/**
 * A what-if on the person's own spending ("what if I cut Food by 20%"), worked out in code from their usual month
 * (the 3-month average for a category, or the average month's spending overall). Returns undefined when the question is
 * not a what-if or names no percentage.
 */
export function detectScenario(
  question: string,
  facts: Facts,
): Facts["scenario"] | undefined {
  const q = question.toLowerCase();
  if (
    !/\b(cut|reduce|trim|lower|decrease|spend less|save more|what if|if i)\b/.test(
      q,
    )
  )
    return undefined;
  const pct = /(\d+(?:\.\d+)?)\s*(?:%|percent|per\s?cent)/.exec(q);
  if (!pct) return undefined;
  const percent = Number(pct[1]);
  if (!(percent > 0 && percent <= 100)) return undefined;

  const cat = (facts.categories ?? []).find((c) =>
    q.includes(c.name.toLowerCase()),
  );
  let usual: number;
  let label: string;
  if (cat) {
    usual = n(cat.avg3m) > 0 ? n(cat.avg3m) : n(cat.thisMonth);
    label = cat.name;
  } else if (
    /\b(spend|spending|expenses?|everything|overall|all)\b/.test(q) &&
    facts.history &&
    facts.history.length > 0
  ) {
    const done =
      facts.history.length > 1 ? facts.history.slice(0, -1) : facts.history;
    usual = done.reduce((s, h) => s + n(h.spending), 0) / done.length;
    label = "overall spending";
  } else return undefined;
  if (!(usual > 0)) return undefined;

  const saves = (usual * percent) / 100;
  return {
    what: label,
    percent,
    usualMonthly: money(usual),
    newMonthly: money(usual - saves),
    savesPerMonth: money(saves),
    savesPerYear: money(saves * 12),
    ...(facts.monthlyNet
      ? {
          monthlySavingNow: facts.monthlyNet.amount,
          monthlySavingAfter: money(n(facts.monthlyNet.amount) + saves),
        }
      : {}),
  };
}
