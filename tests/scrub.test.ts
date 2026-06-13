import { test } from "node:test";
import assert from "node:assert/strict";
import { scrub, scrubDeep, shannonEntropy } from "../src/distiller/scrub.ts";

test("redacts known provider key formats", () => {
  const cases: [string, string][] = [
    ["sk-ant-api03-abcdef1234567890ABCDEF", "anthropic-key"],
    ["sk-proj-abc123ABC456def789GHI012jkl", "openai-key"],
    ["AKIAIOSFODNN7EXAMPLE", "aws-access-key"],
    ["ghp_" + "a".repeat(36), "github-token"],
    ["github_pat_" + "b".repeat(30), "github-pat"],
    ["AIza" + "C".repeat(35), "google-api-key"],
    ["xoxb-123456789012-abcdefABCDEF", "slack-token"],
    ["sk_live_" + "d".repeat(24), "stripe-key"],
    [
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      "jwt",
    ],
  ];
  for (const [secret, type] of cases) {
    const r = scrub(`value is ${secret} here`);
    assert.ok(!r.clean.includes(secret), `${type} not redacted: ${r.clean}`);
    assert.ok(r.clean.includes(`[REDACTED:${type}]`), `wrong token for ${type}: ${r.clean}`);
    assert.ok(r.findings.some((f) => f.type === type && f.count === 1));
  }
});

test("bearer token keeps the 'Bearer ' prefix", () => {
  const r = scrub("Authorization: Bearer abcdefghij1234567890ABCDEFxyz");
  assert.ok(r.clean.includes("Bearer [REDACTED:bearer-token]"), r.clean);
});

test("PEM private-key block redacted, line count preserved", () => {
  const input = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEpAIBAAKCAQEAabcdef0123456789",
    "ghijklMNOPQRSTUVWXYZ+/=abcdef0123",
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");
  const r = scrub(input);
  assert.equal(r.clean.split("\n").length, 4, "line count must be preserved");
  assert.ok(!r.clean.includes("MIIEpAIBA"), "key body leaked");
  assert.ok(r.clean.split("\n").every((l) => l === "[REDACTED:private-key]"));
  assert.deepEqual(r.findings, [{ type: "private-key", count: 1 }]);
});

test("contextual assignment: high-entropy value redacted, prefix kept", () => {
  const r = scrub("password=Xq7kLp9wRt2mNb8v");
  assert.equal(r.clean, "password=[REDACTED:assignment]");
});

test("contextual assignment: low-entropy value left alone", () => {
  const input = "password=aaaaaaaaaaaa";
  assert.equal(scrub(input).clean, input);
});

test("does not redact a value with spaces after a credential key", () => {
  const input = "secret: hello world this has spaces";
  assert.equal(scrub(input).clean, input);
});

test("does NOT redact 64-hex content hashes (false-positive guard)", () => {
  const hex = "a3f1b2c4d5e6f7089a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071";
  assert.equal(hex.length, 64);
  const r = scrub(`head = ${hex}`);
  assert.equal(r.clean, `head = ${hex}`);
  assert.equal(r.findings.length, 0);
});

test("line count preserved across a multi-line mixed input", () => {
  const input = "line one\nsk-ant-api03-abcdef1234567890ABCDEF\nline three\n";
  const r = scrub(input);
  assert.equal(r.clean.split("\n").length, input.split("\n").length);
});

test("scrubDeep walks nested structures, preserves non-strings, no mutation", () => {
  const input = {
    a: "key sk-ant-api03-abcdef1234567890ABCDEF",
    b: ["ghp_" + "a".repeat(36), 42, null, true],
    c: { d: "plain text", e: 3.14 },
  };
  const frozen = JSON.stringify(input);
  const r = scrubDeep(input);
  const out = r.value as typeof input;
  assert.ok(!JSON.stringify(out).includes("sk-ant-"));
  assert.ok(!JSON.stringify(out).includes("ghp_aaaa"));
  assert.equal((out.b as unknown[])[1], 42);
  assert.equal((out.b as unknown[])[2], null);
  assert.equal(out.c.d, "plain text");
  assert.equal(out.c.e, 3.14);
  assert.ok(r.findings.some((f) => f.type === "anthropic-key"));
  assert.ok(r.findings.some((f) => f.type === "github-token"));
  assert.equal(JSON.stringify(input), frozen, "input must not be mutated");
});

test("shannonEntropy: empty is 0, uniform is low, random is high", () => {
  assert.equal(shannonEntropy(""), 0);
  assert.equal(shannonEntropy("aaaa"), 0);
  assert.ok(shannonEntropy("Xq7kLp9wRt2mNb8v") > 3);
});
