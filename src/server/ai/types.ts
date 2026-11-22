export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  signal?: AbortSignal;
  /** Per-call timeout; the gateway sets it from configuration. */
  timeoutMs?: number;
}
export interface CompletionResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export type ProviderErrorKind =
  | "rate_limit"
  | "auth"
  | "server"
  | "bad_request"
  | "network"
  | "timeout"
  | "empty"
  | "model_unavailable";

/** A provider failure with a safe, key-free message. `kind` decides whether failing over to another key is sensible. */
export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    public readonly retryAfterMs?: number,
  ) {
    super(`AI provider error: ${kind}`);
  }
  /** Worth trying a different key or provider. A bad request will fail the same way everywhere, so it is not. */
  get failoverWorthy() {
    return this.kind !== "bad_request";
  }
}

export interface ProviderClient {
  id: "gemini" | "groq";
  complete(
    apiKey: string,
    model: string,
    req: CompletionRequest,
  ): Promise<CompletionResult>;
  /** Same call, but text is handed over as it is written. Optional: a provider without it is called once and shown whole. */
  stream?(
    apiKey: string,
    model: string,
    req: CompletionRequest,
    onDelta: (text: string) => void,
  ): Promise<CompletionResult>;
}
