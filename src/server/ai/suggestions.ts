import type { Facts } from "./grounding";

export type StarterKind =
  | "learn"
  | "spend"
  | "budget"
  | "worth"
  | "category"
  | "save"
  | "bills"
  | "goals"
  | "subs"
  | "pace";
export interface Starter {
  text: string;
  kind: StarterKind;
}

/** Questions worth asking right now, chosen from what the person actually has recorded. Pure, so it is tested. */
export function starters(f: Facts | null): Starter[] {
  const out: Starter[] = [
    { text: "How much did I spend this month?", kind: "spend" },
  ];
  if (f?.categories) {
    const risen = f.categories
      .filter(
        (c) =>
          c.changePercent !== null &&
          c.changePercent >= 15 &&
          Number(c.thisMonth) > 0,
      )
      .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0];
    if (risen)
      out.push({
        text: `Why is my ${risen.name} spending up?`,
        kind: "category",
      });
  }
  if (f && f.budgets.length > 0)
    out.push({
      text: "Am I on track with my budgets this month?",
      kind: "budget",
    });
  else
    out.push({
      text: "How much can I spend per day this month?",
      kind: "pace",
    });
  if (f?.bills && f.bills.length > 0)
    out.push({ text: "What bills are coming up?", kind: "bills" });
  if (f?.goals && f.goals.length > 0)
    out.push({ text: "How are my savings goals going?", kind: "goals" });
  if (f?.subscriptions)
    out.push({
      text: "How much do my subscriptions cost me a year?",
      kind: "subs",
    });
  out.push({
    text: "How many months to save for a 10K purchase?",
    kind: "save",
  });
  out.push({ text: "How big should my emergency fund be?", kind: "learn" });
  out.push({
    text: "What would the EMI be on a 5 lakh loan at 10% for 3 years?",
    kind: "learn",
  });
  out.push({ text: "What is my net worth right now?", kind: "worth" });
  return out.slice(0, 8);
}

/** Up to three natural next questions after an answer, picked by topic. */
export function followUps(question: string): string[] {
  const q = question.toLowerCase();
  const pick: string[] =
    /emi|loan|interest|credit|sip|invest|fund|tax|insurance|retire|pension|inflation|ppf|nps|mutual/.test(
      q,
    )
      ? [
          "How would that apply to my own numbers?",
          "What is the safest way to start?",
          "What mistakes should I avoid here?",
        ]
      : /bill|due|subscri/.test(q)
        ? [
            "How much do my subscriptions cost me a year?",
            "What is due in the next week?",
            "Which bill is the biggest?",
          ]
        : /goal/.test(q)
          ? [
              "Which goal is furthest behind?",
              "How much should I put in each month?",
              "What is my net worth right now?",
            ]
          : /save|afford|month/.test(q)
            ? [
                "Where could I cut back?",
                "How are my savings goals going?",
                "How much can I spend per day this month?",
              ]
            : /categor|why|up|more|compare|biggest|most/.test(q)
              ? [
                  "How does this compare with last month?",
                  "Which payee did I spend the most at?",
                  "How much can I spend per day this month?",
                ]
              : /worth|balance|account|owe|debt/.test(q)
                ? [
                    "How much do I owe in total?",
                    "How many months could I live on my savings?",
                    "How much did I spend this month?",
                  ]
                : [
                    "How much did I spend this month?",
                    "What bills are coming up?",
                    "How are my savings goals going?",
                  ];
  return pick
    .filter((p) => p.toLowerCase() !== q.replace(/\s+/g, " ").trim())
    .slice(0, 3);
}
