import type { UsageStore } from "./assistant";

type Rpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** The per-person usage store backed by the ai_reserve / ai_settle functions. Shared by the assistant and statement tasks. */
export function usageStoreFor(supabase: Rpc): UsageStore {
  return {
    async reserve(limits) {
      type Reason =
        | "hourly"
        | "daily"
        | "plan_day"
        | "plan_month"
        | "plan_window"
        | "minute";
      // Rolling-window allowances (migration 19). Before it is applied, the per-day plan allowance (migration 14) is used.
      const plan = limits.plan;
      if (plan?.questionsPerWindow && plan.windowHours) {
        const { data, error } = await supabase.rpc("ai_reserve_window", {
          p_per_minute: plan.perMinute ?? 10,
          p_window_hours: plan.windowHours,
          p_window_max: plan.questionsPerWindow,
          p_day_max: plan.questionsPerDay,
          p_day_start: plan.dayStart,
          p_tokens_per_month: plan.tokensPerMonth,
          p_month_start: plan.monthStart,
          p_kind: "chat",
          p_kind_day_max: null,
        });
        if (!error) {
          const p = data as {
            allowed: boolean;
            id?: number;
            reason?: Reason | "kind_day";
            retry_at?: string;
          };
          if (p.allowed && p.id !== undefined)
            return { allowed: true, id: p.id };
          const reason: Reason =
            p.reason === "kind_day" || !p.reason ? "plan_day" : p.reason;
          return {
            allowed: false,
            reason,
            ...(p.retry_at
              ? { retryAt: new Date(p.retry_at).toISOString() }
              : {}),
          };
        }
      }
      if (limits.plan) {
        const { data, error } = await supabase.rpc("ai_reserve_plan", {
          p_per_hour: limits.perHour,
          p_questions_per_day: limits.plan.questionsPerDay,
          p_day_start: limits.plan.dayStart,
          p_tokens_per_month: limits.plan.tokensPerMonth,
          p_month_start: limits.plan.monthStart,
        });
        if (!error) {
          const p = data as { allowed: boolean; id?: number; reason?: Reason };
          return p.allowed && p.id !== undefined
            ? { allowed: true, id: p.id }
            : { allowed: false, reason: p.reason ?? "hourly" };
        }
      }
      const { data, error } = await supabase.rpc("ai_reserve", {
        p_per_hour: limits.perHour,
        p_tokens_per_day: limits.tokensPerDay,
      });
      if (error) return { allowed: false, reason: "not_ready" };
      const r = data as {
        allowed: boolean;
        id?: number;
        reason?: "hourly" | "daily";
      };
      return r.allowed && r.id !== undefined
        ? { allowed: true, id: r.id }
        : { allowed: false, reason: r.reason ?? "hourly" };
    },
    async settle(id, r) {
      const base = {
        p_id: id,
        p_status: r.status,
        p_provider: r.provider,
        p_model: r.model,
        p_prompt: r.promptTokens,
        p_completion: r.completionTokens,
        p_latency: r.latencyMs,
      };
      const { error } = await supabase.rpc("ai_settle", {
        ...base,
        p_error_kind: r.errorKind ?? null,
        p_attempts: r.attempts ?? 0,
        p_fallbacks: r.fallbacks ?? 0,
        p_rate_limited: r.rateLimited ?? 0,
      });
      // Before migration 11 is applied only the original seven-argument function exists.
      if (error) await supabase.rpc("ai_settle", base);
    },
  };
}
