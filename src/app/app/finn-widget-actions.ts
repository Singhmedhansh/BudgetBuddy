"use server";

import { MESSAGES } from "@/server/ai/assistant";
import { loadQuota, type Quota } from "@/server/ai/chats";
import { aiStatus } from "@/server/ai/config";
import { loadFacts } from "@/server/ai/facts";
import { insightsFrom, type Insight } from "@/server/ai/insights";
import { planLimitsFor } from "@/server/ai/session";
import { starters, type Starter } from "@/server/ai/suggestions";
import { requireSpace } from "@/server/context";

export interface FinnWidgetData {
  available: boolean;
  unavailableMessage: string;
  name: string | null;
  starters: Starter[];
  insights: Insight[];
  quota: Quota | null;
}

/** What the floating chat needs the first time it is opened. Read on demand, so no other page pays for it. */
export async function loadFinnWidgetAction(): Promise<FinnWidgetData> {
  const ctx = await requireSpace();
  const status = aiStatus();
  const { plan } = await planLimitsFor(ctx);
  const quota = await loadQuota(
    ctx.supabase,
    plan,
    new Date(),
    ctx.profile.timezone,
  );
  let facts: Awaited<ReturnType<typeof loadFacts>> | null = null;
  if (status.available) {
    try {
      facts = await loadFacts(ctx);
    } catch {
      facts = null;
    }
  }
  return {
    available: status.available,
    unavailableMessage: MESSAGES.disabled,
    name: ctx.profile.display_name?.trim().split(/\s+/)[0] ?? null,
    starters: starters(facts),
    insights: facts ? insightsFrom(facts).slice(0, 2) : [],
    quota,
  };
}
