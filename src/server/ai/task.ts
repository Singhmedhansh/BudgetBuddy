import { aiStatus, readAiConfig, type AiConfig } from "./config";
import type { UsageStore } from "./assistant";
import { AiUnavailableError, generate, type RouterResult } from "./router";
import type { CompletionRequest } from "./types";

export type TaskFailure = "disabled" | "limit" | "unavailable";
export type TaskResult = { ok: true; text: string } | { ok: false; reason: TaskFailure };

export interface TaskDeps {
  config?: AiConfig;
  usage: UsageStore;
  generate?: (config: AiConfig, req: CompletionRequest) => Promise<RouterResult>;
  now?: () => number;
}

/**
 * One model call for a background task (reading or categorising a statement), with the same guarantees as the
 * assistant: nothing is called unless AI is switched on and configured, usage is reserved before the call and
 * settled after it, and a failure is reported as a category, never as a provider message or a key.
 */
export async function runTask(deps: TaskDeps, req: Omit<CompletionRequest, "timeoutMs">): Promise<TaskResult> {
  const config = deps.config ?? readAiConfig();
  if (!aiStatus(config).available) return { ok: false, reason: "disabled" };
  const slot = await deps.usage.reserve({ perHour: config.limits.perHour, tokensPerDay: config.limits.tokensPerDay });
  if (!slot.allowed) return { ok: false, reason: slot.reason === "not_ready" ? "unavailable" : "limit" };

  const now = deps.now ?? Date.now;
  const started = now();
  try {
    const out = await (deps.generate ?? generate)(config, req);
    await deps.usage
      .settle(slot.id, {
        status: "ok",
        provider: out.provider,
        model: out.model,
        promptTokens: out.promptTokens,
        completionTokens: out.completionTokens,
        latencyMs: now() - started,
        attempts: out.attempts,
        fallbacks: out.fallbacks,
        rateLimited: out.rateLimited,
      })
      .catch(() => undefined);
    return { ok: true, text: out.text };
  } catch (e) {
    const trail = e instanceof AiUnavailableError ? e.trail : [];
    const kind = e instanceof AiUnavailableError ? (e.cause_ === "all_failed" ? (trail.at(-1)?.kind ?? "all_failed") : e.cause_) : "internal";
    await deps.usage
      .settle(slot.id, { status: "error", provider: null, model: null, promptTokens: 0, completionTokens: 0, latencyMs: now() - started, errorKind: kind, attempts: trail.length, rateLimited: trail.filter((t) => t.kind === "rate_limit").length })
      .catch(() => undefined);
    return { ok: false, reason: "unavailable" };
  }
}

/** Pulls a JSON array out of a model reply that may wrap it in a code fence or a sentence. */
export function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
