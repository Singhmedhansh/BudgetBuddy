import type { PlanId } from "@/config/plans";

export interface EntitlementRow {
  plan: PlanId;
  status: "active" | "trialing" | "past_due" | "canceled";
  current_period_end: string | null;
}
export interface Entitlement {
  plan: PlanId;
  /** Why this plan applies, in words the UI can show. */
  reason: "free" | "paid" | "trial" | "grace" | "lapsed";
  until: string | null;
}

const GRACE_DAYS = 7;
const FREE: Entitlement = { plan: "free", reason: "free", until: null };

/**
 * The plan a person is entitled to right now. A paid plan applies while its period is current; a failed renewal keeps
 * it for a short grace period; a cancelled plan runs to the end of the period already paid for. Anything missing,
 * malformed or expired is the Free plan, so a gap in billing data can never grant paid access.
 */
export function resolveEntitlement(row: EntitlementRow | null | undefined, now: Date): Entitlement {
  if (!row || row.plan !== "pro") return FREE;
  const end = row.current_period_end ? new Date(row.current_period_end).getTime() : NaN;
  if (!Number.isFinite(end)) return FREE;
  const t = now.getTime();
  if (row.status === "active") return end > t ? { plan: "pro", reason: "paid", until: row.current_period_end } : { plan: "free", reason: "lapsed", until: row.current_period_end };
  if (row.status === "trialing") return end > t ? { plan: "pro", reason: "trial", until: row.current_period_end } : { plan: "free", reason: "lapsed", until: row.current_period_end };
  if (row.status === "past_due") return end + GRACE_DAYS * 864e5 > t ? { plan: "pro", reason: "grace", until: row.current_period_end } : { plan: "free", reason: "lapsed", until: row.current_period_end };
  if (row.status === "canceled") return end > t ? { plan: "pro", reason: "paid", until: row.current_period_end } : { plan: "free", reason: "lapsed", until: row.current_period_end };
  return FREE;
}
