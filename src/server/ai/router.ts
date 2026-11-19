import { PROVIDERS } from "./providers";
import { type AiConfig } from "./config";
import { ProviderError, type CompletionRequest, type CompletionResult, type ProviderClient, type ProviderErrorKind } from "./types";

/**
 * Failover, deliberately not rotation. A key is used until it fails; only then is the next one tried, and only a
 * limited number of times per request. Keys are never cycled to get around a quota: per-person limits are enforced
 * before any call is made, and a key that reports a bad credential, or a provider that reports rate limiting, is set
 * aside for a cooldown so traffic is not thrown at it again.
 */
export class KeyPool {
  private coolingUntil = new Map<string, number>();
  private modelCoolingUntil = new Map<string, number>();
  private next = 0;
  constructor(
    private readonly keys: string[],
    private readonly now: () => number = Date.now,
  ) {}

  private available(): string[] {
    const t = this.now();
    return this.keys.filter((k) => (this.coolingUntil.get(k) ?? 0) <= t);
  }
  /** Keys usable right now, starting from the last one that worked so a healthy key stays in use. */
  candidates(): string[] {
    const a = this.available();
    if (a.length === 0) return [];
    const start = this.next % a.length;
    return [...a.slice(start), ...a.slice(0, start)];
  }
  markOk(key: string) {
    const i = this.available().indexOf(key);
    if (i >= 0) this.next = i;
  }
  /**
   * `providerWide` rests every key, used for rate limits when the keys may share one quota: asking another key
   * would be refused the same way and only burn an attempt.
   */
  markFailed(key: string, err: ProviderError, providerWide = false) {
    const cooldown = err.kind === "rate_limit" ? (err.retryAfterMs ?? 60_000) : err.kind === "auth" ? 15 * 60_000 : err.kind === "server" ? 30_000 : 0;
    if (cooldown <= 0) return;
    const until = this.now() + cooldown;
    if (providerWide && err.kind === "rate_limit") this.keys.forEach((k) => this.coolingUntil.set(k, until));
    else this.coolingUntil.set(key, until);
  }
  /** A model the provider says is gone is not asked again for a while; the next model in the list is used. */
  markModelUnavailable(model: string, ms = 30 * 60_000) {
    this.modelCoolingUntil.set(model, this.now() + ms);
  }
  modelAvailable(model: string) {
    return (this.modelCoolingUntil.get(model) ?? 0) <= this.now();
  }
  get size() {
    return this.keys.length;
  }
  /** Counts only, for health display. Never the keys. */
  health() {
    return { keys: this.keys.length, keysAvailable: this.available().length, modelsResting: [...this.modelCoolingUntil.keys()].filter((m) => !this.modelAvailable(m)) };
  }
}

export interface AttemptRecord {
  provider: string;
  model: string;
  kind: ProviderErrorKind;
}

export class AiUnavailableError extends Error {
  constructor(
    public readonly cause_: "no_providers" | "all_failed" | "bad_request",
    public readonly trail: AttemptRecord[] = [],
  ) {
    super(`AI unavailable: ${cause_}`);
  }
}

export interface RouterResult extends CompletionResult {
  provider: string;
  model: string;
  /** Upstream calls made for this question, including the successful one. */
  attempts: number;
  /** Failed attempts that preceded the answer (0 when the first call worked). */
  fallbacks: number;
  /** How many of those failures were rate limits. */
  rateLimited: number;
}

const pools = new Map<string, KeyPool>();
const poolFor = (id: string, keys: string[]) => {
  const sig = `${id}:${keys.join(",")}`; // in-memory only; never logged
  let p = pools.get(sig);
  if (!p) pools.set(sig, (p = new KeyPool(keys)));
  return p;
};

/** Health of the pools in this server instance: counts and model names only. Instances do not share it. */
export function gatewayHealth(config: AiConfig, pool: (id: string, keys: string[]) => KeyPool = poolFor) {
  return config.providers.map((p) => ({ provider: p.id, models: p.models ?? [p.model], ...pool(p.id, p.keys).health() }));
}

/** At most this many upstream calls for one question, across all providers, keys and retries. */
export const MAX_UPSTREAM_ATTEMPTS = 4;
/** A transient failure (5xx, timeout, network) is retried once on the same key before moving on. */
export const MAX_SAME_KEY_RETRIES = 1;
export const BACKOFF_BASE_MS = 300;

/** Exponential backoff with full jitter: random in [0, base * 2^attempt). Bounded so a retry never stalls a request. */
export function backoffMs(attempt: number, random: () => number = Math.random, base = BACKOFF_BASE_MS) {
  return Math.floor(random() * Math.min(base * 2 ** attempt, 2_000));
}

const TRANSIENT: ProviderErrorKind[] = ["server", "timeout", "network"];

export interface GatewayHooks {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export async function generate(
  config: AiConfig,
  req: CompletionRequest,
  clients: Record<string, ProviderClient> = PROVIDERS,
  pool: (id: string, keys: string[]) => KeyPool = poolFor,
  hooks: GatewayHooks = {},
): Promise<RouterResult> {
  if (config.providers.length === 0) throw new AiUnavailableError("no_providers");
  const sleep = hooks.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const call = { ...req, timeoutMs: req.timeoutMs ?? config.limits.timeoutMs };
  const trail: AttemptRecord[] = [];
  let attempts = 0;
  let sawBadRequest = false;
  const fail = () => new AiUnavailableError(sawBadRequest ? "bad_request" : "all_failed", trail);

  for (const p of config.providers) {
    const client = clients[p.id];
    const keys = pool(p.id, p.keys);
    for (const model of p.models?.length ? p.models : [p.model]) {
      if (!keys.modelAvailable(model)) continue;
      let nextModel = false;
      let providerRested = false;
      for (const key of keys.candidates()) {
        if (nextModel || providerRested) break;
        for (let retry = 0; ; retry++) {
          if (attempts >= MAX_UPSTREAM_ATTEMPTS) throw fail();
          attempts++;
          try {
            const out = await client.complete(key, model, call);
            keys.markOk(key);
            return { ...out, provider: p.id, model, attempts, fallbacks: trail.length, rateLimited: trail.filter((t) => t.kind === "rate_limit").length };
          } catch (e) {
            const err = e instanceof ProviderError ? e : new ProviderError("network");
            trail.push({ provider: p.id, model, kind: err.kind });
            keys.markFailed(key, err, !config.independentKeyQuota);
            // The same request will be refused the same way by the next key, so do not spend more calls on it.
            if (!err.failoverWorthy) {
              sawBadRequest = true;
              throw fail();
            }
            if (err.kind === "model_unavailable") {
              keys.markModelUnavailable(model);
              nextModel = true;
              break;
            }
            // A transient failure gets one jittered retry on the same key; everything else moves on.
            if (TRANSIENT.includes(err.kind) && retry < MAX_SAME_KEY_RETRIES && attempts < MAX_UPSTREAM_ATTEMPTS) {
              await sleep(backoffMs(retry, hooks.random));
              continue;
            }
            // Shared quota: the provider is rested, so stop asking its other keys and fall back to the next provider.
            if (err.kind === "rate_limit" && !config.independentKeyQuota) providerRested = true;
            break;
          }
        }
      }
      if (!nextModel) break; // only a retired model moves to the provider's next model
    }
  }
  throw fail();
}
