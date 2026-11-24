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
 * A client for any OpenAI-compatible chat endpoint (OpenRouter, Cloudflare Workers AI, Mistral). The key travels in the
 * Authorization header only. A failure reported as an event mid-stream (OpenRouter does this) is treated as a server
 * error so the gateway can fail over.
 */
function openAiCompatible(
  id: ProviderClient["id"],
  url: () => string | null,
  extraHeaders: Record<string, string> = {},
): ProviderClient {
  const headers = (apiKey: string) => ({
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...extraHeaders,
  });
  const body = (model: string, req: CompletionRequest) => ({
    model,
    messages: [{ role: "system", content: req.system }, ...req.messages],
    max_tokens: req.maxOutputTokens,
    temperature: 0.2,
  });
  const endpoint = () => {
    const u = url();
    if (!u) throw new ProviderError("auth");
    return u;
  };
  const client: ProviderClient = {
    id,
    async complete(apiKey, model, req): Promise<CompletionResult> {
      const json = (await send(
        endpoint(),
        {
          method: "POST",
          headers: headers(apiKey),
          body: JSON.stringify(body(model, req)),
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
  client.stream = async (apiKey, model, req, onDelta) => {
    let failed = false;
    let text = "";
    let promptTokens = 0;
    let completionTokens = 0;
    await sendStream(
      endpoint(),
      {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({
          ...body(model, req),
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
  return client;
}

/**
 * OpenRouter's free models (ids ending in :free, or the openrouter/free router). Free use is capped per account, so it
 * is a last fallback, for general questions only. The two extra headers are OpenRouter's optional attribution.
 */
export const openrouter = openAiCompatible(
  "openrouter",
  () => "https://openrouter.ai/api/v1/chat/completions",
  { "http-referer": "https://getfintrack.online", "x-title": "FinTrack" },
);

/**
 * Cloudflare Workers AI through its OpenAI-compatible endpoint. The URL needs the account id
 * (CLOUDFLARE_ACCOUNT_ID, not a secret); the key is an API token with Workers AI permission. 10,000 free neurons a day.
 */
export const cloudflare = openAiCompatible("cloudflare", () => {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  return account && /^[a-f0-9]{32}$/i.test(account)
    ? `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`
    : null;
});

/** Mistral's API. On the free Experiment plan requests may be used for training, so it is used for general questions only. */
export const mistral = openAiCompatible(
  "mistral",
  () => "https://api.mistral.ai/v1/chat/completions",
);

export const PROVIDERS = {
  gemini,
  groq,
  cloudflare,
  mistral,
  openrouter,
} as const;
