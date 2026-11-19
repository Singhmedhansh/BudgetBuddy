import type { UsageStore } from "./assistant";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** The per-person usage store backed by the ai_reserve / ai_settle functions. Shared by the assistant and statement tasks. */
export function usageStoreFor(supabase: Rpc): UsageStore {
  return {
    async reserve(limits) {
      const { data, error } = await supabase.rpc("ai_reserve", { p_per_hour: limits.perHour, p_tokens_per_day: limits.tokensPerDay });
      if (error) return { allowed: false, reason: "not_ready" };
      const r = data as { allowed: boolean; id?: number; reason?: "hourly" | "daily" };
      return r.allowed && r.id !== undefined ? { allowed: true, id: r.id } : { allowed: false, reason: r.reason ?? "hourly" };
    },
    async settle(id, r) {
      const base = { p_id: id, p_status: r.status, p_provider: r.provider, p_model: r.model, p_prompt: r.promptTokens, p_completion: r.completionTokens, p_latency: r.latencyMs };
      const { error } = await supabase.rpc("ai_settle", { ...base, p_error_kind: r.errorKind ?? null, p_attempts: r.attempts ?? 0, p_fallbacks: r.fallbacks ?? 0, p_rate_limited: r.rateLimited ?? 0 });
      // Before migration 11 is applied only the original seven-argument function exists.
      if (error) await supabase.rpc("ai_settle", base);
    },
  };
}
