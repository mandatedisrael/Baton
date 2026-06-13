/**
 * Tolerant JSON extraction for LLM responses.
 *
 * Models wrap JSON in prose or ```fences``` despite instructions; this pulls
 * the object out (fenced block first, else the outer brace span) and parses it.
 * A response with no JSON object at all is a hard failure, not a silent empty.
 */
import { LLMError } from "../llm/client.ts";

export function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new LLMError("response contained no JSON object", { code: "bad_response" });
  }
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LLMError("response was not a JSON object", { code: "bad_response" });
  }
  return parsed as Record<string, unknown>;
}
