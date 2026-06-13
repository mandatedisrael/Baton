import { test } from "node:test";
import assert from "node:assert/strict";
import { AnthropicClient } from "../src/llm/anthropic.ts";
import { LLMError } from "../src/llm/client.ts";

// A minimal stand-in for fetch that records the request and returns a canned
// HTTP response. This exercises the real request-assembly and response-parsing
// code paths without a live API call (no key, "build but don't run").
function fakeFetch(
  responses: { status: number; body: unknown; headers?: Record<string, string> }[],
): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers,
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const okBody = {
  model: "claude-opus-4-8",
  stop_reason: "end_turn",
  content: [
    { type: "thinking", thinking: "" },
    { type: "text", text: "hello " },
    { type: "text", text: "world" },
  ],
  usage: { input_tokens: 10, output_tokens: 3 },
};

test("assembles the request and parses the response", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body: okBody }]);
  const client = new AnthropicClient({ apiKey: "sk-test", fetchImpl });

  const res = await client.complete({
    system: "be terse",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 1024,
    effort: "low",
  });

  assert.equal(res.text, "hello world"); // thinking block excluded
  assert.equal(res.model, "claude-opus-4-8");
  assert.equal(res.stopReason, "end_turn");
  assert.deepEqual(res.usage, { inputTokens: 10, outputTokens: 3 });

  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.url, "https://api.anthropic.com/v1/messages");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], "sk-test");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(call.init.body as string);
  assert.equal(body.model, "claude-opus-4-8");
  assert.equal(body.max_tokens, 1024);
  assert.equal(body.system, "be terse");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
});

test("uses the configured default model when none is given", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body: okBody }]);
  const client = new AnthropicClient({ apiKey: "k", fetchImpl, defaultModel: "claude-haiku-4-5" });
  await client.complete({ messages: [{ role: "user", content: "x" }], maxTokens: 64 });
  assert.equal(JSON.parse(calls[0]!.init.body as string).model, "claude-haiku-4-5");
});

test("throws a typed error without an API key (never silently no-ops)", async () => {
  const { fetchImpl } = fakeFetch([{ status: 200, body: okBody }]);
  const client = new AnthropicClient({ apiKey: "", fetchImpl });
  await assert.rejects(
    () => client.complete({ messages: [{ role: "user", content: "x" }], maxTokens: 64 }),
    (e: unknown) => e instanceof LLMError && e.code === "no_api_key",
  );
});

test("treats stop_reason 'refusal' as an error", async () => {
  const { fetchImpl } = fakeFetch([
    { status: 200, body: { model: "claude-opus-4-8", stop_reason: "refusal", content: [] } },
  ]);
  const client = new AnthropicClient({ apiKey: "k", fetchImpl });
  await assert.rejects(
    () => client.complete({ messages: [{ role: "user", content: "x" }], maxTokens: 64 }),
    (e: unknown) => e instanceof LLMError && e.code === "refusal",
  );
});

test("retries a 429 then succeeds", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { status: 429, body: { error: "slow down" }, headers: { "retry-after": "0" } },
    { status: 200, body: okBody },
  ]);
  const client = new AnthropicClient({ apiKey: "k", fetchImpl, sleep: async () => {} });
  const res = await client.complete({ messages: [{ role: "user", content: "x" }], maxTokens: 64 });
  assert.equal(res.text, "hello world");
  assert.equal(calls.length, 2);
});

test("gives up on a non-retryable 400", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 400, body: { error: "bad" } }]);
  const client = new AnthropicClient({ apiKey: "k", fetchImpl, sleep: async () => {} });
  await assert.rejects(
    () => client.complete({ messages: [{ role: "user", content: "x" }], maxTokens: 64 }),
    (e: unknown) => e instanceof LLMError && e.status === 400,
  );
  assert.equal(calls.length, 1); // no retry on 400
});

test("exhausts retries on persistent 500", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 500, body: { error: "boom" } }]);
  const client = new AnthropicClient({ apiKey: "k", fetchImpl, maxRetries: 2, sleep: async () => {} });
  await assert.rejects(() =>
    client.complete({ messages: [{ role: "user", content: "x" }], maxTokens: 64 }),
  );
  assert.equal(calls.length, 3); // initial + 2 retries
});
