import type { createAdminClient } from "@/server/admin";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

export interface ModelUsage {
  questions: number;
  failed: number;
  rateLimited: number;
  cached: number | null;
  byProvider: { provider: string; calls: number; tokens: number }[];
}

/**
 * Model use over the last 24 hours, so a free provider's daily limit is never a surprise. Counts and totals only: no
 * question, answer or person is read. Null when the usage table cannot be read (before migration 18).
 */
export async function loadModelUsage(admin: Admin): Promise<ModelUsage | null> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await admin
    .from("ai_usage")
    .select("provider,status,prompt_tokens,completion_tokens,rate_limited")
    .gte("created_at", since)
    .limit(5000);
  if (error || !data) return null;
  const by = new Map<string, { calls: number; tokens: number }>();
  let failed = 0;
  let limited = 0;
  for (const r of data as {
    provider: string | null;
    status: string;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    rate_limited: number | null;
  }[]) {
    if (r.status === "error") failed++;
    limited += r.rate_limited ?? 0;
    const k = r.provider ?? "none";
    const cur = by.get(k) ?? { calls: 0, tokens: 0 };
    cur.calls++;
    cur.tokens += (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0);
    by.set(k, cur);
  }
  const { count } = await admin
    .from("finn_answer_cache")
    .select("key", { count: "exact", head: true });
  return {
    questions: data.length,
    failed,
    rateLimited: limited,
    cached: count ?? null,
    byProvider: [...by.entries()].map(([provider, v]) => ({ provider, ...v })),
  };
}
