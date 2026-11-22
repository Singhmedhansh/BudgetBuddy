import { AI_ALLOWANCE, type PlanId } from "@/config/plans";
import type { requireSpace } from "@/server/context";
import {
  resolveEntitlement,
  type EntitlementRow,
} from "@/server/payments/entitlements";
import { periodStarts } from "./chats";

type Ctx = Awaited<ReturnType<typeof requireSpace>>;

/**
 * The person's plan and the allowance that goes with it, with the start of their day and month in their own time zone.
 * Anything unreadable counts as the Free plan. Used by the page, the streaming route and WhatsApp, so all three apply
 * exactly the same limits.
 */
export async function planLimitsFor(ctx: Pick<Ctx, "supabase" | "profile">) {
  const { data: ent } = await ctx.supabase
    .from("entitlements")
    .select("plan,status,current_period_end")
    .maybeSingle();
  const plan: PlanId = resolveEntitlement(
    ent as EntitlementRow | null,
    new Date(),
  ).plan;
  const { dayStart, monthStart } = periodStarts(
    new Date(),
    ctx.profile.timezone,
  );
  const allowance = AI_ALLOWANCE[plan];
  return {
    plan,
    limits: {
      questionsPerDay: allowance.questionsPerDay,
      tokensPerMonth: allowance.tokensPerMonth,
      dayStart: dayStart.toISOString(),
      monthStart: monthStart.toISOString(),
    },
  };
}
