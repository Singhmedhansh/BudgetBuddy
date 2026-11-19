"use server";

import { z } from "zod";
import { requireSpace } from "@/server/context";
import { ask, MESSAGES, type UsageStore } from "@/server/ai/assistant";
import { loadFacts } from "@/server/ai/facts";
import { coalesce, flightKey } from "@/server/ai/inflight";

export interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Marks an answer built only from verified figures rather than free model text. */
  source?: "model" | "figures";
}
export interface AssistantState {
  turns: Turn[];
  error?: string;
  question?: string;
}

const turnSchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000), source: z.enum(["model", "figures"]).optional() })).max(12);

export async function askAssistantAction(prev: AssistantState | undefined, form: FormData): Promise<AssistantState> {
  const ctx = await requireSpace();
  let parsedHistory: unknown = [];
  try {
    parsedHistory = JSON.parse(String(form.get("history") ?? "[]") || "[]");
  } catch {
    /* a malformed history field is treated as an empty conversation */
  }
  const history = turnSchema.safeParse(parsedHistory);
  const turns: Turn[] = history.success ? history.data : [];
  const question = String(form.get("question") ?? "");

  const usage: UsageStore = {
    async reserve(limits) {
      const { data, error } = await ctx.supabase.rpc("ai_reserve", { p_per_hour: limits.perHour, p_tokens_per_day: limits.tokensPerDay });
      if (error) return { allowed: false, reason: "not_ready" };
      const r = data as { allowed: boolean; id?: number; reason?: "hourly" | "daily" };
      return r.allowed && r.id !== undefined ? { allowed: true, id: r.id } : { allowed: false, reason: r.reason ?? "hourly" };
    },
    async settle(id, r) {
      const base = { p_id: id, p_status: r.status, p_provider: r.provider, p_model: r.model, p_prompt: r.promptTokens, p_completion: r.completionTokens, p_latency: r.latencyMs };
      const { error } = await ctx.supabase.rpc("ai_settle", { ...base, p_error_kind: r.errorKind ?? null, p_attempts: r.attempts ?? 0, p_fallbacks: r.fallbacks ?? 0, p_rate_limited: r.rateLimited ?? 0 });
      // Before migration 11 is applied only the original seven-argument function exists: settle with that, so tokens
      // and the daily allowance are still recorded whichever order the code and the migration go out in.
      if (error) await ctx.supabase.rpc("ai_settle", base);
    },
  };

  // Identical concurrent submissions from this person share one reservation and one provider call.
  const history2 = turns.map(({ role, content }) => ({ role, content }));
  const out = await coalesce(flightKey(ctx.user.id, ctx.space.id, question.trim(), JSON.stringify(history2.slice(-4))), () => ask(question, { usage, loadFacts: () => loadFacts(ctx) }, history2));
  if (!out.ok) return { turns, error: out.message ?? MESSAGES.unavailable, question };
  const next: Turn[] = [...turns, { role: "user", content: question.trim() }, { role: "assistant", content: out.answer, source: out.source }];
  return { turns: next.slice(-12) };
}
