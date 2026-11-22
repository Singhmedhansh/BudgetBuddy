/**
 * AI configuration, read from server-only environment variables. Nothing here has a NEXT_PUBLIC_ prefix, so none of
 * it can reach the browser, and key values are never logged, returned or placed in error messages.
 *
 *   AI_ENABLED=true              master switch; off by default
 *   GEMINI_API_KEY_1..3 / GEMINI_API_KEYS=k1,k2   keys for Google Gemini (both forms are read)
 *   GROQ_API_KEY_1..4 / GROQ_API_KEYS=k1,k2       keys for Groq
 *   AI_PROVIDER_ORDER=gemini,groq   which provider is tried first; the next is the fallback
 *   GEMINI_MODEL / GROQ_MODEL    model ids, comma-separated for ordered alternatives (defaults below)
 *   AI_<FEATURE>_<PROVIDER>_MODEL   per-feature override, e.g. AI_ASSISTANT_GEMINI_MODEL
 *   AI_KEYS_INDEPENDENT_QUOTA=true  only if each key is in a separate project / organisation
 *   AI_REQUESTS_PER_HOUR, AI_TOKENS_PER_DAY, AI_MAX_OUTPUT_TOKENS, AI_MAX_QUESTION_CHARS   per-person limits
 */
export type ProviderId = "gemini" | "groq";
export const PROVIDER_IDS: ProviderId[] = ["gemini", "groq"];

/**
 * Features that call the gateway. Only the assistant exists today; add an id here when a feature is built, and it
 * can then be pointed at its own model through AI_<FEATURE>_<PROVIDER>_MODEL without touching code.
 */
export type AiFeature = "assistant";

const KEYS_ENV: Record<ProviderId, string> = { gemini: "GEMINI_API_KEYS", groq: "GROQ_API_KEYS" };
/** Numbered variables (GEMINI_API_KEY_1, GEMINI_API_KEY_2, ...) are read as well as the comma-separated pool. */
const NUMBERED_ENV: Record<ProviderId, string> = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY" };
const MODEL_ENV: Record<ProviderId, string> = { gemini: "GEMINI_MODEL", groq: "GROQ_MODEL" };
/**
 * Defaults are ordered: the first is tried, the next only when the provider reports the model gone. The previous
 * defaults (gemini-2.0-flash, llama-3.3-70b-versatile) were retired by their providers in 2026, so they are not
 * listed. Model catalogues move quickly: confirm these with `npm run ai:models` before enabling, and override with
 * GEMINI_MODEL / GROQ_MODEL (comma-separated lists are accepted) without a code change.
 */
const MODEL_DEFAULT: Record<ProviderId, string[]> = { gemini: ["gemini-3.5-flash-lite", "gemini-3.6-flash"], groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"] };

const int = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
};

/** Distinct, trimmed, non-empty keys. A key listed twice is used once, so the pool cannot be inflated by repetition. */
export function parseKeys(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((k) => k.trim()).filter(Boolean))];
}

/** Keys from `<NAME>_1 .. <NAME>_9` followed by the comma-separated pool, de-duplicated, numbered ones first. */
export function collectKeys(env: Record<string, string | undefined>, id: ProviderId): string[] {
  const numbered = Array.from({ length: 9 }, (_, i) => env[`${NUMBERED_ENV[id]}_${i + 1}`]?.trim() ?? "").filter(Boolean);
  return [...new Set([...numbered, ...parseKeys(env[KEYS_ENV[id]])])];
}

const parseModels = (raw: string | undefined) => [...new Set((raw ?? "").split(",").map((m) => m.trim()).filter(Boolean))];

export interface AiProviderConfig {
  id: ProviderId;
  /** First choice. Kept for callers that only need one name. */
  model: string;
  /** Ordered candidates: the next is used only if the provider says the previous model is not available. */
  models?: string[];
  keys: string[];
}

export interface AiConfig {
  enabled: boolean;
  /** Providers that have at least one key, in the order they will be tried. */
  providers: AiProviderConfig[];
  /**
   * False (the default): keys of one provider are assumed to share a quota, as Gemini keys in one Google project and
   * Groq keys in one organisation do. A rate limit then rests the whole provider and the request falls back to the
   * other provider rather than spending more calls on the same quota. Set AI_KEYS_INDEPENDENT_QUOTA=true only when
   * every key really belongs to a separate project or organisation.
   */
  independentKeyQuota?: boolean;
  limits: { perHour: number; tokensPerDay: number; maxOutputTokens: number; maxQuestionChars: number; timeoutMs: number };
}

export function readAiConfig(env: Record<string, string | undefined> = process.env, feature: AiFeature = "assistant"): AiConfig {
  const order = (env.AI_PROVIDER_ORDER ?? "gemini,groq")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderId => PROVIDER_IDS.includes(s as ProviderId));
  const ordered = [...new Set([...order, ...PROVIDER_IDS])];
  const modelsFor = (id: ProviderId) => {
    const featureModels = parseModels(env[`AI_${feature.toUpperCase()}_${id.toUpperCase()}_MODEL`]);
    const configured = parseModels(env[MODEL_ENV[id]]);
    return featureModels.length ? featureModels : configured.length ? configured : MODEL_DEFAULT[id];
  };
  return {
    enabled: env.AI_ENABLED === "true",
    providers: ordered
      .map((id) => {
        const models = modelsFor(id);
        return { id, model: models[0], models, keys: collectKeys(env, id) };
      })
      .filter((p) => p.keys.length > 0),
    independentKeyQuota: env.AI_KEYS_INDEPENDENT_QUOTA === "true",
    limits: {
      perHour: int(env.AI_REQUESTS_PER_HOUR, 30, 1, 500),
      tokensPerDay: int(env.AI_TOKENS_PER_DAY, 150_000, 1_000, 5_000_000),
      maxOutputTokens: int(env.AI_MAX_OUTPUT_TOKENS, 500, 50, 4000),
      maxQuestionChars: int(env.AI_MAX_QUESTION_CHARS, 600, 20, 4000),
      timeoutMs: int(env.AI_TIMEOUT_MS, 20_000, 2_000, 60_000),
    },
  };
}

export type AiStatus = { available: true } | { available: false; reason: "disabled" | "no_providers" };

/** What the UI is allowed to know: whether the assistant can run, and never which keys or providers are set up. */
export function aiStatus(config: AiConfig = readAiConfig()): AiStatus {
  if (!config.enabled) return { available: false, reason: "disabled" };
  if (config.providers.length === 0) return { available: false, reason: "no_providers" };
  return { available: true };
}
