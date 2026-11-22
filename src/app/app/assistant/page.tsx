import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { PageHeader } from "@/components/app/ui";
import { AssistantChat } from "@/components/app/AssistantChat";
import { MESSAGES } from "@/server/ai/assistant";
import { aiStatus } from "@/server/ai/config";
import { requireSpace } from "@/server/context";
import { loadFacts } from "@/server/ai/facts";
import { starters } from "@/server/ai/suggestions";

export const metadata: Metadata = { title: "Finn" };

const money = (v: string, cur: string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: 0,
  }).format(Number(v));

export default async function AssistantPage() {
  const ctx = await requireSpace();
  const status = aiStatus();
  // The starters and the snapshot come from the person's own records; if they cannot be read, the page still works.
  let facts: Awaited<ReturnType<typeof loadFacts>> | null = null;
  if (status.available) {
    try {
      facts = await loadFacts(ctx);
    } catch {
      facts = null;
    }
  }
  const cur = ctx.space.currency;
  const nextBill = facts?.bills?.[0];
  const snapshot =
    facts?.pace && facts.history && facts.history.length > 0
      ? [
          {
            label: `Spent in ${facts.thisMonth.label}`,
            value: money(facts.thisMonth.spending, cur),
          },
          {
            label: "On pace to spend",
            value: money(facts.pace.projectedMonthEnd, cur),
          },
          nextBill
            ? {
                label: `Next: ${nextBill.name}`,
                value: `${money(nextBill.amount, cur)} on ${new Date(nextBill.due).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
              }
            : { label: "Net worth", value: money(facts.netWorth, cur) },
        ]
      : [];
  const name = ctx.profile.display_name?.trim().split(/\s+/)[0] ?? null;
  return (
    <>
      <PageHeader
        title={`Ask ${BRAND.assistantName}`}
        description={`${BRAND.assistantName} answers questions about your own recorded money and works out savings goals. Every figure is checked against your records.`}
      />
      <div className="mx-auto max-w-3xl">
        <AssistantChat
          available={status.available}
          unavailableMessage={MESSAGES.disabled}
          name={name}
          starters={starters(facts)}
          snapshot={snapshot}
        />
      </div>
    </>
  );
}
