import { PROVIDERS } from "./providers";
import { type AiConfig } from "./config";
import { ProviderError, type CompletionRequest, type CompletionResult, type ProviderClient } from "./types";

/**
 * Failover, deliberately not rotation. A key is used until it fails; only then is the next one tried, and only a
 * limited number of times per request. Keys are never cycled to get around a quota: per-person limits are enforced
 * before any call is made, and a key that reports rate limiting or a bad credential is set aside for a cooldown so
 * traffic is not thrown at it again.
 */
export class KeyPool {
  private coolingUntil = new Map<string, number>();
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
  markFailed(key: string, err: ProviderError) {
    const cooldown = err.kind === "rate_limit" ? (err.retryAfterMs ?? 60_000) : err.kind === "auth" ? 15 * 60_000 : err.kind === "server" ? 30_000 : 0;
    if (cooldown > 0) this.coolingUntil.set(key, this.now() + cooldown);
  }
  get size() {
    return this.keys.length;
  }
}

export class AiUnavailableError extends Error {
  constructor(public readonly cause_: "no_providers" | "all_failed" | "bad_request") {
    super(`AI unavailable: ${cause_}`);
  }
}

export interface RouterResult extends CompletionResult {
  provider: string;
  model: string;
}

const pools = new Map<string, KeyPool>();
const poolFor = (id: string, keys: string[]) => {
  const sig = `${id}:${keys.join(",")}`; // in-memory only; never logged
  let p = pools.get(sig);
  if (!p) pools.set(sig, (p = new KeyPool(keys)));
  return p;
};

/** At most this many upstream calls for one question, across all providers and keys. */
export const MAX_UPSTREAM_ATTEMPTS = 3;

export async function generate(
  config: AiConfig,
  req: CompletionRequest,
  clients: Record<string, ProviderClient> = PROVIDERS,
  pool: (id: string, keys: string[]) => KeyPool = poolFor,
): Promise<RouterResult> {
  if (config.providers.length === 0) throw new AiUnavailableError("no_providers");
  let attempts = 0;
  let sawBadRequest = false;
  for (const p of config.providers) {
    const client = clients[p.id];
    const keys = pool(p.id, p.keys);
    for (const key of keys.candidates()) {
      if (attempts >= MAX_UPSTREAM_ATTEMPTS) throw new AiUnavailableError(sawBadRequest ? "bad_request" : "all_failed");
      attempts++;
      try {
        const out = await client.complete(key, p.model, req);
        keys.markOk(key);
        return { ...out, provider: p.id, model: p.model };
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError("network");
        keys.markFailed(key, err);
        // The same request will be refused the same way by the next key, so do not spend more calls on it.
        if (!err.failoverWorthy) {
          sawBadRequest = true;
          break;
        }
        // A rate-limited or failing key moves on to the next key of the same provider, then the next provider.
      }
    }
  }
  throw new AiUnavailableError(sawBadRequest ? "bad_request" : "all_failed");
}
