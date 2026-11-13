import { ProviderError, type CompletionRequest, type CompletionResult, type ProviderClient, type ProviderErrorKind } from "./types";

/** Maps an HTTP status to a failure kind without ever including the response body or the key in the error. */
export function kindFromStatus(status: number): ProviderErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status >= 500) return "server";
  return "bad_request";
}

/** Seconds or an HTTP date from a Retry-After header, in milliseconds, capped so a hostile value cannot park a key for long. */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  const ms = Number.isFinite(secs) ? secs * 1000 : new Date(header).getTime() - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 5 * 60_000) : undefined;
}

async function send(url: string, init: RequestInit, req: CompletionRequest, timeoutMs: number): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (e) {
    throw new ProviderError((e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError" ? "timeout" : "network");
  }
  if (!res.ok) throw new ProviderError(kindFromStatus(res.status), retryAfterMs(res.headers.get("retry-after")));
  try {
    return await res.json();
  } catch {
    throw new ProviderError("server");
  }
}

const TIMEOUT = 20_000;

/** Google Gemini via the REST API. The key travels in a header, never in the URL, so it cannot end up in logs. */
export const gemini: ProviderClient = {
  id: "gemini",
  async complete(apiKey, model, req): Promise<CompletionResult> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: req.maxOutputTokens, temperature: 0.2 },
    };
    const json = (await send(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body) },
      req,
      TIMEOUT,
    )) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new ProviderError("empty");
    return { text, promptTokens: json.usageMetadata?.promptTokenCount ?? 0, completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0 };
  },
};

/** Groq's OpenAI-compatible chat endpoint. */
export const groq: ProviderClient = {
  id: "groq",
  async complete(apiKey, model, req): Promise<CompletionResult> {
    const body = {
      model,
      messages: [{ role: "system", content: req.system }, ...req.messages],
      max_tokens: req.maxOutputTokens,
      temperature: 0.2,
    };
    const json = (await send(
      "https://api.groq.com/openai/v1/chat/completions",
      { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) },
      req,
      TIMEOUT,
    )) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new ProviderError("empty");
    return { text, promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0 };
  },
};

export const PROVIDERS = { gemini, groq } as const;
