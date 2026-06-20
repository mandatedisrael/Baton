import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureCodexFile,
  findLatestCodexSession,
  parseCodexTranscript,
} from "../src/distiller/capture/codex.ts";
import { hashBytes } from "../src/core/hash.ts";

function fixture(cwd = "/repo"): string {
  return [
    JSON.stringify({ timestamp: "2026-06-20T10:00:00.000Z", type: "session_meta", payload: {
      id: "codex-session", cwd, git: { branch: "main" },
    } }),
    JSON.stringify({ timestamp: "2026-06-20T10:00:01.000Z", type: "turn_context", payload: {
      cwd, model: "gpt-5.5",
    } }),
    JSON.stringify({ timestamp: "2026-06-20T10:00:02.000Z", type: "response_item", payload: {
      type: "message", role: "developer", content: [{ type: "input_text", text: "hidden instructions" }],
    } }),
    JSON.stringify({ timestamp: "2026-06-20T10:00:03.000Z", type: "response_item", payload: {
      type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>meta</environment_context>" }],
    } }),
    JSON.stringify({ timestamp: "2026-06-20T10:00:04.000Z", type: "response_item", payload: {
      type: "message", role: "user", content: [{ type: "input_text", text: "Fix the auth race" }],
    } }),
    JSON.stringify({ timestamp: "2026-06-20T10:00:05.000Z", type: "response_item", payload: {
      type: "message", role: "assistant", content: [{ type: "output_text", text: "I will inspect it." }],
    } }),
    JSON.stringify({ timestamp: "2026-06-20T10:00:06.000Z", type: "response_item", payload: {
      type: "custom_tool_call", call_id: "call-1", name: "exec", input: "{\"cmd\":\"npm test\"}",
    } }),
    JSON.stringify({ timestamp: "2026-06-20T10:00:07.000Z", type: "response_item", payload: {
      type: "custom_tool_call_output", call_id: "call-1", output: [{ type: "input_text", text: "1 test failed" }],
      is_error: true,
    } }),
    "{broken json",
  ].join("\n") + "\n";
}

test("parseCodexTranscript normalizes visible turns, tools, metadata, and citations", () => {
  const raw = fixture();
  const session = parseCodexTranscript(raw);
  assert.equal(session.tool, "codex");
  assert.equal(session.sessionId, "codex-session");
  assert.equal(session.cwd, "/repo");
  assert.equal(session.gitBranch, "main");
  assert.equal(session.model, "gpt-5.5");
  assert.equal(session.raw.hash, hashBytes(raw));
  assert.equal(session.raw.lineCount, 9);
  assert.deepEqual(session.messages.map((message) => message.line), [4, 5, 6, 7, 8]);
  assert.equal(session.messages[0]!.isMeta, true);
  assert.equal(session.messages[1]!.text, "Fix the auth race");
  assert.equal(session.messages[2]!.text, "I will inspect it.");
  assert.deepEqual(session.messages[3]!.toolUses[0], {
    id: "call-1", name: "exec", input: { cmd: "npm test" },
  });
  assert.deepEqual(session.messages[4]!.toolResults[0], {
    toolUseId: "call-1", text: "1 test failed", isError: true,
  });
});

test("captureCodexFile reads the same normalized session", () => {
  const root = mkdtempSync(join(tmpdir(), "baton-codex-file-"));
  try {
    const path = join(root, "rollout.jsonl");
    writeFileSync(path, fixture());
    assert.equal(captureCodexFile(path).sessionId, "codex-session");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findLatestCodexSession selects the newest rollout for the project cwd", () => {
  const root = mkdtempSync(join(tmpdir(), "baton-codex-discovery-"));
  try {
    const sessions = join(root, "sessions", "2026", "06", "20");
    mkdirSync(sessions, { recursive: true });
    const other = join(sessions, "other.jsonl");
    const matching = join(sessions, "matching.jsonl");
    writeFileSync(other, fixture("/other"));
    writeFileSync(matching, fixture("/repo"));
    assert.equal(findLatestCodexSession("/repo", join(root, "sessions")), matching);
    assert.equal(findLatestCodexSession("/missing", join(root, "sessions")), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
