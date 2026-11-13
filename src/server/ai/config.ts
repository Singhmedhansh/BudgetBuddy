/**
 * AI configuration, read from server-only environment variables. Nothing here has a NEXT_PUBLIC_ prefix, so none of
 * it can reach the browser, and key values are never logged, returned or placed in error messages.
 *
 *   AI_ENABLED=true              master switch; off by default
 *   GEMINI_API_KEYS=k1,k2,k3     comma-separated pool for Google Gemini
 *   GROQ_API_KEYS=k1,k2,k3,k4    comma-separated pool for Groq
 *   AI_PROVIDER_ORDER=groq,gemini   which provider is tried first; the next is the fallback
 *   GEMINI_MODEL / GROQ_MODEL    model ids (defaults below)
 *   AI_REQUESTS_PER_HOUR, AI_TOKENS_PER_DAY, AI_MAX_OUTPUT_TOKENS, AI_MAX_QUESTION_CHARS   per-person limits
 */
export type ProviderId = "gemini" | "groq";
export const PROVIDER_IDS: ProviderId[] = ["gemini", "groq"];

const KEYS_ENV: Record<ProviderId, string> = { gemini: "GEMINI_API_KEYS", groq: "GROQ_API_KEYS" };
const MODEL_ENV: Record<ProviderId, string> = { gemini: "GEMINI_MODEL", groq: "GROQ_MODEL" };
const MODEL_DEFAULT: Record<ProviderId, string> = { gemini: "gemini-2.0-flash", groq: "llama-3.3-70b-versatile" };

const int = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
};

/** Distinct, trimmed, non-empty keys. A key listed twice is used once, so the pool cannot be inflated by repetition. */
export function parseKeys(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(",").map((k) => k.trim()).filter(Boolean))];
}

export interface AiConfig {
  enabled: boolean;
  /** Providers that have at least one key, in the order they will be tried. */
  providers: { id: ProviderId; model: string; keys: string[] }[];
  limits: { perHour: number; tokensPerDay: number; maxOutputTokens: number; maxQuestionChars: number; timeoutMs: number };
}

export function readAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const order = (env.AI_PROVIDER_ORDER ?? "groq,gemini")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderId => PROVIDER_IDS.includes(s as ProviderId));
  const ordered = [...new Set([...order, ...PROVIDER_IDS])];
  return {
    enabled: env.AI_ENABLED === "true",
    providers: ordered
      .map((id) => ({ id, model: env[MODEL_ENV[id]]?.trim() || MODEL_DEFAULT[id], keys: parseKeys(env[KEYS_ENV[id]]) }))
      .filter((p) => p.keys.length > 0),
    limits: {
      perHour: int(env.AI_REQUESTS_PER_HOUR, 20, 1, 500),
      tokensPerDay: int(env.AI_TOKENS_PER_DAY, 60_000, 1_000, 5_000_000),
      maxOutputTokens: int(env.AI_MAX_OUTPUT_TOKENS, 700, 50, 4000),
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
