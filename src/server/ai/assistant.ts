import { aiStatus, readAiConfig, type AiConfig } from "./config";
import { referenceFor } from "@/config/reference-data";
import { detectCalculation } from "./calculators";
import { detectScenario } from "./scenario";
import { buildVisuals, type Visual } from "./visuals";
import {
  clean,
  enforceFigures,
  factsSummary,
  savingsPlan,
  splitTag,
  generalPrompt,
  systemPrompt,
  type Facts,
} from "./grounding";
import {
  AiUnavailableError,
  generate,
  generateStream,
  type RouterResult,
} from "./router";
import { SentenceVerifier } from "./stream";
import { cacheKey, type AnswerCache } from "./answer-cache";
import {
  earlierText,
  emptyFacts,
  isGeneralQuestion,
  pruneFacts,
} from "./scope";
import type { ChatMessage, CompletionRequest } from "./types";

export type AssistantOutcome =
  | {
      ok: true;
      answer: string;
      verified: true;
      source: "model" | "figures" | "general";
      visuals?: Visual[];
    }
  | {
      ok: false;
      reason:
        | "disabled"
        | "no_providers"
        | "plan_day"
        | "plan_month"
        | "too_long"
        | "empty"
        | "hourly"
        | "daily"
        | "unavailable"
        | "busy"
        | "not_ready";
      message: string;
    };

/** Sentences shown to people. None names a provider, a key, a model or an internal error. */
export const MESSAGES = {
  disabled:
    "The assistant is not switched on yet. Your dashboard and Analytics already show every figure it will use.",
  no_providers:
    "The assistant is not switched on yet. Your dashboard and Analytics already show every figure it will use.",
  empty:
    "Ask a question about your own money, for example how much you spent this month.",
  hourly:
    "You have reached the hourly limit for the assistant. Try again a little later.",
  daily:
    "You have used today's assistant allowance. It resets within 24 hours.",
  plan_day:
    "You have used all of today's questions for your plan. They reset at midnight.",
  plan_month:
    "You have used this month's Finn allowance for your plan. It resets on the 1st.",
  busy: "Finn is very busy right now and the free service has hit its limit for the moment. Try again in a minute. This did not use up one of your questions.",
  unavailable:
    "The assistant could not answer right now. Nothing was charged to your allowance beyond this try. Please try again in a moment.",
  not_ready:
    "The assistant needs a database update that has not been applied yet.",
} as const;

export interface UsageResult {
  status: "ok" | "error";
  provider: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  /** Failure category (rate_limit, auth, timeout, ...) for the usage dashboard. Never a message or a key. */
  errorKind?: string | null;
  attempts?: number;
  fallbacks?: number;
  rateLimited?: number;
}

export interface UsageStore {
  /** Reserve a call before making it, so parallel requests cannot slip past the limits. */
  reserve(limits: {
    perHour: number;
    tokensPerDay: number;
    plan?: {
      questionsPerDay: number;
      tokensPerMonth: number;
      dayStart: string;
      monthStart: string;
    };
  }): Promise<
    | { allowed: true; id: number }
    | { allowed: false; reason: "hourly" | "daily" | "plan_day" | "plan_month" }
    | { allowed: false; reason: "not_ready" }
  >;
  settle(id: number, r: UsageResult): Promise<void>;
}

export interface AssistantDeps {
  config?: AiConfig;
  usage: UsageStore;
  /** The person's plan allowance and the start of their day and month, counted in the database. */
  plan?: {
    questionsPerDay: number;
    tokensPerMonth: number;
    dayStart: string;
    monthStart: string;
  };
  loadFacts: () => Promise<Facts>;
  /** A smaller chat window: shorter answers, which are also faster. */
  brief?: boolean;
  /** Called as each stage finishes, for timing. Receives only a stage name. */
  trace?: (
    stage: "cache" | "reserved" | "facts" | "first_text" | "model_done",
  ) => void;
  /** Their country and currency. Needed to answer a general question without loading any of their records. */
  region?: { country: string | null; currency: string };
  /** Shared answers to general questions. Absent means every question goes to a model. */
  answerCache?: AnswerCache | null;
  /** A file the person attached to this question (text already extracted). Used for this question only, never stored. */
  document?: { name: string; text: string };
  /** When set, the answer is released sentence by sentence as it is written, each checked first. */
  stream?: {
    status?: (text: string) => void;
    delta: (text: string) => void;
  };
  generateStream?: (
    config: AiConfig,
    req: CompletionRequest,
    onDelta: (text: string) => void,
  ) => Promise<RouterResult>;
  generate?: (
    config: AiConfig,
    req: CompletionRequest,
  ) => Promise<RouterResult>;
  now?: () => number;
}

const fail = (
  reason: Extract<AssistantOutcome, { ok: false }>["reason"],
): AssistantOutcome => ({
  ok: false,
  reason,
  message: MESSAGES[reason as keyof typeof MESSAGES] ?? MESSAGES.unavailable,
});

/**
 * One question, end to end. Order is deliberate: validate, check the switch, reserve usage, gather verified figures,
 * call a provider, verify every figure in the answer, then settle usage. No provider is called unless the assistant
 * is enabled, configured, within limits and has facts to ground on.
 */
export async function ask(
  question: string,
  deps: AssistantDeps,
  history: ChatMessage[] = [],
): Promise<AssistantOutcome> {
  const config = deps.config ?? readAiConfig();
  const status = aiStatus(config);
  if (!status.available) return fail(status.reason);

  const q = question.replace(/\s+/g, " ").trim();
  if (!q) return fail("empty");
  if (q.length > config.limits.maxQuestionChars)
    return {
      ok: false,
      reason: "too_long",
      message: `Keep the question under ${config.limits.maxQuestionChars} characters.`,
    };

  // A question that needs none of their records is answered without loading any, and may already have an answer.
  const earlier = earlierText(history);
  const general =
    Boolean(deps.region) && !deps.document && isGeneralQuestion(q, earlier);
  const calc = general ? detectCalculation(q) : null;
  const cache =
    general && !calc && history.length === 0 && q.length <= 240
      ? (deps.answerCache ?? null)
      : null;
  const key =
    cache && deps.region ? cacheKey(q, deps.region, Boolean(deps.brief)) : "";
  if (cache) {
    const hit = await cache.get(key);
    if (hit) {
      deps.trace?.("cache");
      deps.stream?.delta(hit);
      return {
        ok: true,
        answer: hit,
        verified: true,
        source: "general",
        visuals: [],
      };
    }
  }

  const slot = await deps.usage.reserve({
    perHour: config.limits.perHour,
    tokensPerDay: config.limits.tokensPerDay,
    plan: deps.plan,
  });
  deps.trace?.("reserved");
  if (!slot.allowed) return fail(slot.reason);

  const now = deps.now ?? Date.now;
  const started = now();
  const settle = (
    status: "ok" | "error",
    r?: RouterResult,
    failure?: { kind: string; attempts: number; rateLimited: number },
  ) =>
    deps.usage
      .settle(slot.id, {
        status,
        provider: r?.provider ?? null,
        model: r?.model ?? null,
        promptTokens: r?.promptTokens ?? 0,
        completionTokens: r?.completionTokens ?? 0,
        latencyMs: now() - started,
        errorKind: failure?.kind ?? null,
        attempts: r?.attempts ?? failure?.attempts ?? 0,
        fallbacks: r?.fallbacks ?? Math.max(0, (failure?.attempts ?? 0) - 1),
        rateLimited: r?.rateLimited ?? failure?.rateLimited ?? 0,
      })
      .catch(() => undefined);

  let facts: Facts;
  deps.stream?.status?.(general ? "Thinking" : "Reading your records");
  try {
    facts =
      general && deps.region
        ? emptyFacts(deps.region, new Date(now()).toISOString().slice(0, 10))
        : await deps.loadFacts();
    deps.trace?.("facts");
  } catch {
    await settle("error", undefined, {
      kind: "facts",
      attempts: 0,
      rateLimited: 0,
    });
    return fail("unavailable");
  }

  const plan = savingsPlan(q, facts);
  if (plan) facts = { ...facts, savingsPlan: plan };
  const calculation = detectCalculation(q);
  if (calculation) facts = { ...facts, calculation };
  const scenario = detectScenario(q, facts);
  if (scenario) facts = { ...facts, scenario };
  const reference = referenceFor(q);
  if (reference.length) facts = { ...facts, reference };
  if (deps.document)
    facts = {
      ...facts,
      document: {
        name: clean(deps.document.name, 80),
        text: deps.document.text
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
          .slice(0, 12_000),
      },
    };

  // Pictures are drawn from everything known; the model is shown only what the question needs.
  const allFacts = facts;
  const shown = general ? facts : pruneFacts(facts, q, earlier);
  facts = shown;

  // Only the last few turns are sent, capped in length, so a long conversation cannot inflate cost.
  const turns = history
    .slice(-4)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }));
  const req: CompletionRequest = {
    system: general
      ? generalPrompt(facts, { brief: deps.brief })
      : systemPrompt(facts, { brief: deps.brief }),
    ...(general && !facts.calculation ? { tier: "light" as const } : {}),
    messages: [...turns, { role: "user", content: q }],
    maxOutputTokens: deps.brief
      ? Math.min(config.limits.maxOutputTokens, 280)
      : config.limits.maxOutputTokens,
  };
  let out: RouterResult;
  let firstText = false;
  const verifier = deps.stream
    ? new SentenceVerifier(facts, deps.stream.delta)
    : null;
  deps.stream?.status?.("Working it out");
  try {
    out = verifier
      ? await (deps.generateStream ?? generateStreamed(deps.generate))(
          config,
          req,
          (t) => {
            if (!firstText) {
              firstText = true;
              deps.trace?.("first_text");
            }
            verifier.push(t);
          },
        )
      : await (deps.generate ?? generate)(config, req);
    verifier?.finish();
    deps.trace?.("model_done");
  } catch (e) {
    const trail = e instanceof AiUnavailableError ? e.trail : [];
    const kind =
      e instanceof AiUnavailableError
        ? e.cause_ === "all_failed"
          ? (trail.at(-1)?.kind ?? "all_failed")
          : e.cause_
        : "internal";
    await settle("error", undefined, {
      kind,
      attempts: trail.length,
      rateLimited: trail.filter((t) => t.kind === "rate_limit").length,
    });
    // Every provider refused because its free quota is used up: say so, rather than a vague failure.
    const busy =
      trail.length > 0 && trail.every((t) => t.kind === "rate_limit");
    return fail(busy ? "busy" : "unavailable");
  }
  await settle("ok", out);

  // Every figure about the person must come from the facts. General answers may quote benchmarks, but never their numbers.
  const { tag, body } = splitTag(out.text);
  const checked = enforceFigures(body, tag, facts);
  if (!checked)
    return general
      ? {
          ok: true,
          answer:
            "I could not put together a reliable answer to that one. Try asking it another way.",
          verified: true,
          source: "general",
          visuals: [],
        }
      : {
          ok: true,
          answer: factsSummary(facts),
          verified: true,
          source: "figures",
        };
  // Pictures come from the verified facts, never from the model. A general answer gets one only for a what-if with numbers.
  let visuals: Visual[] = [];
  try {
    visuals =
      facts.document || (tag === "G" && !facts.calculation)
        ? []
        : buildVisuals(q, allFacts);
  } catch {
    visuals = [];
  }
  // A clean general answer contains nothing about anyone, so it can serve the next person who asks the same thing.
  if (cache && tag === "G" && checked.clean && checked.text.length >= 20)
    await cache.set(key, checked.text);
  return {
    ok: true,
    answer: checked.text,
    verified: true,
    source: tag === "G" ? "general" : "model",
    visuals,
  };
}

/** Streams through the gateway, or, when a test supplies its own generate, calls it once and passes the whole text on. */
function generateStreamed(
  custom?: AssistantDeps["generate"],
): NonNullable<AssistantDeps["generateStream"]> {
  if (!custom) return generateStream;
  return async (config, req, onDelta) => {
    const r = await custom(config, req);
    onDelta(r.text);
    return r;
  };
}
