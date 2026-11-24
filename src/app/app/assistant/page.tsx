import type { Metadata } from "next";
import { FinnWorkspace } from "@/components/app/FinnWorkspace";
import { PageHeader } from "@/components/app/ui";
import { BRAND } from "@/config/brand";
import type { PlanId } from "@/config/plans";
import { MESSAGES } from "@/server/ai/assistant";
import { listChats, loadChat, loadQuota } from "@/server/ai/chats";
import { aiStatus } from "@/server/ai/config";
import { loadFacts } from "@/server/ai/facts";
import { loadFinnSettings } from "@/server/ai/finn-settings";
import { isReviewer } from "@/server/ai/reviewers";
import { insightsFrom } from "@/server/ai/insights";
import { starters } from "@/server/ai/suggestions";
import { requireSpace } from "@/server/context";
import {
  resolveEntitlement,
  type EntitlementRow,
} from "@/server/payments/entitlements";

export const metadata: Metadata = { title: "Finn" };

const money = (v: string, cur: string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: 0,
  }).format(Number(v));

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireSpace();
  const status = aiStatus();
  const now = new Date();

  const { data: ent } = await ctx.supabase
    .from("entitlements")
    .select("plan,status,current_period_end")
    .maybeSingle();
  const plan: PlanId = resolveEntitlement(
    ent as EntitlementRow | null,
    now,
  ).plan;
  const [settings, chats, active, quota] = await Promise.all([
    loadFinnSettings(ctx),
    listChats(ctx.supabase),
    sp.c ? loadChat(ctx.supabase, sp.c) : Promise.resolve(null),
    loadQuota(ctx.supabase, plan, now, ctx.profile.timezone),
  ]);

  // The starters and the snapshot come from the person's own records; if they cannot be read, the page still works.
  let facts: Awaited<ReturnType<typeof loadFacts>> | null = null;
  if (status.available && !active) {
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
        description={`${BRAND.assistantName} answers questions about your own recorded money and any money question you have. Every figure about you is checked against your records.`}
        action={
          isReviewer(ctx.user.email)
            ? { href: "/app/finn-review", label: "Review queue" }
            : undefined
        }
      />
      <FinnWorkspace
        chats={chats}
        activeId={active?.id ?? null}
        initialTurns={active?.turns ?? []}
        quota={quota}
        timeZone={ctx.profile.timezone}
        available={status.available}
        unavailableMessage={MESSAGES.disabled}
        name={name}
        starters={starters(facts)}
        snapshot={snapshot}
        insights={facts ? insightsFrom(facts) : []}
        settings={settings}
        historyReady={quota !== null}
      />
    </>
  );
}
