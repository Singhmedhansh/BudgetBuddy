import {
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type ProviderClient,
  type ProviderErrorKind,
} from "./types";

/**
 * Maps a failed response to a failure kind. The body is read only to tell apart cases the status cannot (Gemini
 * answers a bad API key with 400; a retired model is a 404 or a 400 "decommissioned"). It is matched against fixed
 * phrases and never copied into an error, a log or a response.
 */
export function kindFromStatus(status: number, body = ""): ProviderErrorKind {
  const b = body.slice(0, 4000).toLowerCase();
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "server";
  if (/api[_ ]key (not valid|invalid)|api_key_invalid|invalid api key/.test(b))
    return "auth";
  if (
    status === 404 ||
    /model_not_found|decommissioned|no longer supported|is not found for api version|model .{0,60}does not exist/.test(
      b,
    )
  )
    return "model_unavailable";
  return "bad_request";
}

/** Seconds or an HTTP date from a Retry-After header, in milliseconds, capped so a hostile value cannot park a key for long. */
export function retryAfterMs(
  header: string | null,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  const ms = Number.isFinite(secs)
    ? secs * 1000
    : new Date(header).getTime() - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 5 * 60_000) : undefined;
}

async function send(
  url: string,
  init: RequestInit,
  req: CompletionRequest,
  defaultTimeoutMs: number,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(req.timeoutMs ?? defaultTimeoutMs);
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (e) {
    throw new ProviderError(
      (e as Error)?.name === "TimeoutError" ||
        (e as Error)?.name === "AbortError"
        ? "timeout"
        : "network",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(
      kindFromStatus(res.status, body),
      retryAfterMs(res.headers.get("retry-after")),
    );
  }
  try {
    return await res.json();
  } catch {
    throw new ProviderError("server");
  }
}

const TIMEOUT = 20_000;
const STREAM_TIMEOUT = 45_000;

/** Reads a server-sent-events response and hands each JSON payload to onEvent. Errors map to the same kinds as send. */
async function sendStream(
  url: string,
  init: RequestInit,
  req: CompletionRequest,
  onEvent: (json: unknown) => void,
): Promise<void> {
  const timeout = AbortSignal.timeout(
    req.timeoutMs ? req.timeoutMs * 2 : STREAM_TIMEOUT,
  );
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (e) {
    throw new ProviderError(
      (e as Error)?.name === "TimeoutError" ||
        (e as Error)?.name === "AbortError"
        ? "timeout"
        : "network",
    );
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new ProviderError(
      kindFromStatus(res.status || 502, body),
      retryAfterMs(res.headers.get("retry-after")),
    );
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          onEvent(JSON.parse(data));
        } catch {
          /* a malformed event is skipped */
        }
      }
    }
  } catch (e) {
    throw new ProviderError(
      (e as Error)?.name === "TimeoutError" ? "timeout" : "network",
    );
  }
}

/** Google Gemini via the REST API. The key travels in a header, never in the URL, so it cannot end up in logs. */
export const gemini: ProviderClient = {
  id: "gemini",
  async complete(apiKey, model, req): Promise<CompletionResult> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: req.maxOutputTokens,
        temperature: 0.2,
      },
    };
    const json = (await send(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      },
      req,
      TIMEOUT,
    )) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) throw new ProviderError("empty");
    return {
      text,
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },
};

gemini.stream = async (apiKey, model, req, onDelta) => {
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      maxOutputTokens: req.maxOutputTokens,
      temperature: 0.2,
    },
  };
  let text = "";
  let promptTokens = 0;
  let completionTokens = 0;
  await sendStream(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    },
    req,
    (j) => {
      const e = j as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      };
      const t = (e.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
      if (t) {
        text += t;
        onDelta(t);
      }
      if (e.usageMetadata) {
        promptTokens = e.usageMetadata.promptTokenCount ?? promptTokens;
        completionTokens =
          e.usageMetadata.candidatesTokenCount ?? completionTokens;
      }
    },
  );
  if (!text.trim()) throw new ProviderError("empty");
  return { text: text.trim(), promptTokens, completionTokens };
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
      // gpt-oss models reason before answering and the reasoning counts against max_tokens: at a small cap they return
      // an empty answer (finish_reason "length"). Low effort keeps that overhead small.
      ...(model.startsWith("openai/gpt-oss")
        ? { reasoning_effort: "low" }
        : {}),
    };
    const json = (await send(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      },
      req,
      TIMEOUT,
    )) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new ProviderError("empty");
    return {
      text,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  },
};

groq.stream = async (apiKey, model, req, onDelta) => {
  const body = {
    model,
    messages: [{ role: "system", content: req.system }, ...req.messages],
    max_tokens: req.maxOutputTokens,
    temperature: 0.2,
    stream: true,
    stream_options: { include_usage: true },
    ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
  };
  let text = "";
  let promptTokens = 0;
  let completionTokens = 0;
  await sendStream(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    req,
    (j) => {
      const e = j as {
        choices?: { delta?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        x_groq?: {
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
      };
      const t = e.choices?.[0]?.delta?.content ?? "";
      if (t) {
        text += t;
        onDelta(t);
      }
      const u = e.usage ?? e.x_groq?.usage;
      if (u) {
        promptTokens = u.prompt_tokens ?? promptTokens;
        completionTokens = u.completion_tokens ?? completionTokens;
      }
    },
  );
  if (!text.trim()) throw new ProviderError("empty");
  return { text: text.trim(), promptTokens, completionTokens };
};

/**
 * OpenRouter's OpenAI-compatible endpoint, used with its free models (ids ending in :free, or the openrouter/free
 * router). Free use is capped per account, not per key, so it is only ever a last fallback. The two headers are
 * OpenRouter's optional attribution, and carry no key or user data.
 */
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const openrouterHeaders = (apiKey: string) => ({
  "content-type": "application/json",
  authorization: `Bearer ${apiKey}`,
  "http-referer": "https://getfintrack.online",
  "x-title": "FinTrack",
});
const openrouterBody = (model: string, req: CompletionRequest) => ({
  model,
  messages: [{ role: "system", content: req.system }, ...req.messages],
  max_tokens: req.maxOutputTokens,
  temperature: 0.2,
});

export const openrouter: ProviderClient = {
  id: "openrouter",
  async complete(apiKey, model, req): Promise<CompletionResult> {
    const json = (await send(
      OPENROUTER_URL,
      {
        method: "POST",
        headers: openrouterHeaders(apiKey),
        body: JSON.stringify(openrouterBody(model, req)),
      },
      req,
      TIMEOUT,
    )) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = (json.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new ProviderError("empty");
    return {
      text,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  },
};

openrouter.stream = async (apiKey, model, req, onDelta) => {
  let failed = false;
  let text = "";
  let promptTokens = 0;
  let completionTokens = 0;
  await sendStream(
    OPENROUTER_URL,
    {
      method: "POST",
      headers: openrouterHeaders(apiKey),
      body: JSON.stringify({
        ...openrouterBody(model, req),
        stream: true,
        stream_options: { include_usage: true },
      }),
    },
    req,
    (j) => {
      const e = j as {
        choices?: { delta?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: unknown;
      };
      // OpenRouter reports a failure that happens mid-stream as an event rather than a status code.
      if (e.error) failed = true;
      const t = e.choices?.[0]?.delta?.content ?? "";
      if (t) {
        text += t;
        onDelta(t);
      }
      if (e.usage) {
        promptTokens = e.usage.prompt_tokens ?? promptTokens;
        completionTokens = e.usage.completion_tokens ?? completionTokens;
      }
    },
  );
  if (!text.trim()) throw new ProviderError(failed ? "server" : "empty");
  return { text: text.trim(), promptTokens, completionTokens };
};

export const PROVIDERS = { gemini, groq, openrouter } as const;
