import { BRAND } from "@/config/brand";
import type { Facts } from "./grounding";
import { insightsFrom } from "./insights";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export interface Recap {
  subject: string;
  html: string;
  text: string;
}

/**
 * The weekly email: where the month stands, what Finn noticed and what is coming up. Every figure is taken from the same
 * verified facts Finn answers from; nothing is written by a model. Returns null when there is nothing worth sending
 * (no activity yet), so people are not emailed an empty report.
 */
export function buildRecap(
  facts: Facts,
  opts: { name: string | null; origin: string },
): Recap | null {
  const hasActivity =
    Number(facts.thisMonth.spending) > 0 ||
    Number(facts.thisMonth.income) > 0 ||
    (facts.history?.length ?? 0) > 0;
  if (!hasActivity) return null;

  const cur = facts.space.currency;
  const money = (v: string | number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(Number(v));
  const insights = insightsFrom(facts);
  const lines: string[] = [];
  lines.push(
    `Spent so far in ${facts.thisMonth.label}: ${money(facts.thisMonth.spending)}`,
  );
  if (facts.pace)
    lines.push(
      `On pace to spend: ${money(facts.pace.projectedMonthEnd)} by month end`,
    );
  if (facts.thisMonth.keptPercent !== null)
    lines.push(`Kept so far: ${facts.thisMonth.keptPercent}% of income`);
  const top = facts.topCategories.slice(0, 3);
  const bills = (facts.bills ?? []).slice(0, 3);
  const link = `${opts.origin.replace(/\/$/, "")}/app/assistant`;
  const hi = opts.name ? `Hi ${opts.name},` : "Hi,";
  const subject = `Your week with ${BRAND.assistantName}: ${money(facts.thisMonth.spending)} spent in ${facts.thisMonth.label}`;

  const text = [
    hi,
    "",
    `Here is where your money stands, from your own records.`,
    "",
    ...lines,
    ...(top.length
      ? [
          "",
          "Biggest categories:",
          ...top.map((c) => `- ${c.name}: ${money(c.amount)}`),
        ]
      : []),
    ...(bills.length
      ? [
          "",
          "Coming up:",
          ...bills.map((b) => `- ${b.name}: ${money(b.amount)} on ${b.due}`),
        ]
      : []),
    ...(insights.length
      ? [
          "",
          `${BRAND.assistantName} noticed:`,
          ...insights.map((i) => `- ${i.text}`),
        ]
      : []),
    "",
    `Ask ${BRAND.assistantName} about any of it: ${link}`,
    "",
    `You get this because you turned on the weekly recap. Turn it off any time on the Finn page.`,
  ].join("\n");

  const li = (s: string) => `<li style="margin:0 0 6px">${s}</li>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f5f1;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1b19">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
<p style="font-size:15px;margin:0 0 4px">${esc(hi)}</p>
<h1 style="font-size:22px;margin:0 0 16px">Your week with ${esc(BRAND.assistantName)}</h1>
<div style="background:#fff;border:1px solid #e6e3da;border-radius:14px;padding:18px 20px;margin:0 0 16px">
<ul style="margin:0;padding-left:18px;font-size:15px;line-height:1.5">${lines.map((l) => li(esc(l))).join("")}</ul>
</div>
${
  top.length
    ? `<h2 style="font-size:14px;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:#6b6860">Biggest categories</h2><ul style="margin:0;padding-left:18px;font-size:15px">${top.map((c) => li(`${esc(c.name)}: <strong>${esc(money(c.amount))}</strong>`)).join("")}</ul>`
    : ""
}
${
  bills.length
    ? `<h2 style="font-size:14px;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:#6b6860">Coming up</h2><ul style="margin:0;padding-left:18px;font-size:15px">${bills.map((b) => li(`${esc(b.name)}: <strong>${esc(money(b.amount))}</strong> on ${esc(b.due)}`)).join("")}</ul>`
    : ""
}
${
  insights.length
    ? `<h2 style="font-size:14px;margin:18px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:#6b6860">${esc(BRAND.assistantName)} noticed</h2><ul style="margin:0;padding-left:18px;font-size:15px">${insights.map((i) => li(esc(i.text))).join("")}</ul>`
    : ""
}
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#1f5d4a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:999px;font-size:15px;display:inline-block">Ask ${esc(BRAND.assistantName)}</a></p>
<p style="font-size:12px;color:#6b6860;margin:0">You get this because you turned on the weekly recap. Turn it off any time on the Finn page.</p>
</div></body></html>`;
  return { subject, html, text };
}
