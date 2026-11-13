"use server";

import { z } from "zod";
import { requireSpace } from "@/server/context";
import { ask, MESSAGES, type UsageStore } from "@/server/ai/assistant";
import { loadFacts } from "@/server/ai/facts";

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
      await ctx.supabase.rpc("ai_settle", { p_id: id, p_status: r.status, p_provider: r.provider, p_model: r.model, p_prompt: r.promptTokens, p_completion: r.completionTokens, p_latency: r.latencyMs });
    },
  };

  const out = await ask(question, { usage, loadFacts: () => loadFacts(ctx) }, turns.map(({ role, content }) => ({ role, content })));
  if (!out.ok) return { turns, error: out.message ?? MESSAGES.unavailable, question };
  const next: Turn[] = [...turns, { role: "user", content: question.trim() }, { role: "assistant", content: out.answer, source: out.source }];
  return { turns: next.slice(-12) };
}
