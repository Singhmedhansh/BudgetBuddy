"use server";

import { z } from "zod";
import type { Visual } from "@/server/ai/visuals";
import { requireSpace } from "@/server/context";
import { ask, MESSAGES, type UsageStore } from "@/server/ai/assistant";
import { loadFacts } from "@/server/ai/facts";
import { usageStoreFor } from "@/server/ai/usage-store";
import { coalesce, flightKey } from "@/server/ai/inflight";

export interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Marks an answer built only from verified figures rather than free model text. */
  source?: "model" | "figures" | "general";
  /** Charts and cards built from the verified figures, shown under the answer. */
  visuals?: Visual[];
}
export interface AssistantState {
  turns: Turn[];
  error?: string;
  question?: string;
}

const turnSchema = z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000), source: z.enum(["model", "figures", "general"]).optional(), visuals: z.array(z.any()).max(4).optional() })).max(12);

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

  const usage: UsageStore = usageStoreFor(ctx.supabase);

  // Identical concurrent submissions from this person share one reservation and one provider call.
  const history2 = turns.map(({ role, content }) => ({ role, content }));
  const out = await coalesce(flightKey(ctx.user.id, ctx.space.id, question.trim(), JSON.stringify(history2.slice(-4))), () => ask(question, { usage, loadFacts: () => loadFacts(ctx) }, history2));
  if (!out.ok) return { turns, error: out.message ?? MESSAGES.unavailable, question };
  const next: Turn[] = [...turns, { role: "user", content: question.trim() }, { role: "assistant", content: out.answer, source: out.source, visuals: out.visuals }];
  return { turns: next.slice(-12) };
}
