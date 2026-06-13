/**
 * Provider-agnostic LLM client (plan §3.3 — the distiller's model boundary).
 *
 * The distiller (extractor + fidelity grader) depends on this interface, never
 * on a concrete provider, so a user can run extraction on whatever model they
 * already pay for. The Anthropic implementation lives in ./anthropic.ts; other
 * providers slot in by implementing `LLMClient`.
 *
 * Default model is Claude Opus 4.8 (`claude-opus-4-8`). The model is overridable
 * per request — e.g. point the grader at a cheaper model — but that's the
 * caller's choice, made explicitly, not a silent downgrade.
 */

/** Latest Claude Opus — the default for extraction and grading. */
export const DEFAULT_MODEL = "claude-opus-4-8" as const;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  system?: string;
  messages: LLMMessage[];
  /** Defaults to the client's configured model (DEFAULT_MODEL). */
  model?: string;
  maxTokens: number;
  /** Adaptive thinking on (default true for the reasoning tasks here). */
  thinking?: boolean;
  effort?: Effort;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  /** Concatenated visible text (thinking blocks excluded). */
  text: string;
  model: string;
  stopReason: string;
  usage: LLMUsage;
}

export interface LLMClient {
  complete(req: LLMRequest): Promise<LLMResponse>;
}

export class LLMError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options?: { status?: number; code?: string; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "LLMError";
    this.status = options?.status;
    this.code = options?.code;
  }
}
