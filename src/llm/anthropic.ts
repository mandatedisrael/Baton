/**
 * Anthropic implementation of LLMClient over the Messages API.
 *
 * Uses `fetch` (a Node built-in) rather than `@anthropic-ai/sdk` to preserve
 * BATON's zero-runtime-dependency invariant. Request/response shapes follow the
 * Messages API: POST /v1/messages with x-api-key + anthropic-version headers;
 * the response carries a `content` block array (text + thinking), `stop_reason`,
 * and `usage`. Adaptive thinking is the only thinking mode on Opus 4.8.
 *
 * Retries 429 / 5xx / network errors with exponential backoff (honoring
 * retry-after). The key is read from ANTHROPIC_API_KEY unless passed in.
 */
import { DEFAULT_MODEL, LLMError, type LLMClient, type LLMRequest, type LLMResponse } from "./client.ts";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export interface AnthropicClientOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  maxRetries?: number;
  /** Injectable for testing — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable backoff sleep — defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
  model?: string;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export class AnthropicClient implements LLMClient {
  private readonly apiKey: string | undefined;
  private readonly url: string;
  private readonly defaultModel: string;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: AnthropicClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.url = opts.baseUrl ?? API_URL;
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.maxRetries = opts.maxRetries ?? 2;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new LLMError("ANTHROPIC_API_KEY is not set", { code: "no_api_key" });
    }

    const body: Record<string, unknown> = {
      model: req.model ?? this.defaultModel,
      max_tokens: req.maxTokens,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.system !== undefined) body.system = req.system;
    if (req.thinking !== false) body.thinking = { type: "adaptive" };
    if (req.effort !== undefined) body.output_config = { effort: req.effort };

    const res = await this.send(JSON.stringify(body));
    const data = (await res.json()) as AnthropicMessageResponse;

    if (data.stop_reason === "refusal") {
      throw new LLMError("model declined the request (refusal)", { code: "refusal" });
    }

    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");

    return {
      text,
      model: data.model ?? (req.model ?? this.defaultModel),
      stopReason: data.stop_reason ?? "end_turn",
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
    };
  }

  /** POST with retry on transient failures. Returns a 2xx response or throws. */
  private async send(payload: string): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(this.backoff(attempt, lastErr));

      let res: Response;
      try {
        res = await this.fetchImpl(this.url, {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey!,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
          },
          body: payload,
        });
      } catch (err) {
        lastErr = err; // network failure — retry
        continue;
      }

      if (res.ok) return res;

      const detail = await res.text().catch(() => "");
      const error = new LLMError(`Anthropic API error ${res.status}: ${detail.slice(0, 500)}`, {
        status: res.status,
      });
      if (!RETRYABLE.has(res.status) || attempt === this.maxRetries) throw error;
      lastErr = { retryAfter: res.headers.get("retry-after") };
    }
    throw new LLMError("request failed after retries", { code: "retries_exhausted", cause: lastErr });
  }

  private backoff(attempt: number, lastErr: unknown): number {
    const hint =
      lastErr && typeof lastErr === "object" && "retryAfter" in lastErr
        ? Number((lastErr as { retryAfter: string | null }).retryAfter)
        : NaN;
    if (Number.isFinite(hint) && hint >= 0) return hint * 1000;
    return 500 * 2 ** (attempt - 1); // 500ms, 1s, 2s, ...
  }
}
