import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  captureClaudeCodeFile,
  parseClaudeCodeTranscript,
} from "../src/distiller/capture/claude-code.ts";
import { transcriptAttachment } from "../src/distiller/capture/transcript.ts";
import { hashBytes } from "../src/core/hash.ts";

// A synthetic transcript covering every line type and shape we parse, plus a
// blank line and a malformed line (which must be tolerated, not fatal).
function fixture(): string {
  const L = [
    JSON.stringify({
      type: "user",
      isMeta: true,
      message: { role: "user", content: "<meta reminder>" },
      uuid: "u0",
      sessionId: "S1",
      cwd: "/repo",
      gitBranch: "main",
      timestamp: "2026-06-13T00:00:00.000Z",
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "Fix the auth bug" },
      uuid: "u1",
      parentUuid: "u0",
      timestamp: "2026-06-13T00:01:00.000Z",
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-8",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "the race is on the token", signature: "s" },
          { type: "text", text: "Let me read the file." },
          { type: "tool_use", id: "t1", name: "Read", input: { path: "auth.ts" } },
        ],
      },
      uuid: "a1",
      parentUuid: "u1",
    }),
    "", // blank line — skipped, but line numbering must not shift
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "file contents", is_error: false }],
      },
      uuid: "u2",
    }),
    '{"type":"assistant" THIS IS BROKEN JSON', // malformed — tolerated
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-4-8", role: "assistant", content: [{ type: "text", text: "Done." }] },
      uuid: "a2",
    }),
    JSON.stringify({ type: "system", subtype: "compact_boundary", content: "compacted" }),
  ];
  return L.join("\n") + "\n";
}

test("parses turns with correct 1-based line numbers (blank/malformed skipped)", () => {
  const s = parseClaudeCodeTranscript(fixture());
  assert.deepEqual(
    s.messages.map((m) => m.line),
    [1, 2, 3, 5, 7, 8],
  );
});

test("extracts session metadata and latest model", () => {
  const s = parseClaudeCodeTranscript(fixture());
  assert.equal(s.tool, "claude-code");
  assert.equal(s.sessionId, "S1");
  assert.equal(s.cwd, "/repo");
  assert.equal(s.gitBranch, "main");
  assert.equal(s.model, "claude-opus-4-8");
});

test("flattens text, thinking, tool_use and tool_result", () => {
  const s = parseClaudeCodeTranscript(fixture());
  const meta = s.messages[0]!;
  assert.equal(meta.isMeta, true);
  assert.equal(meta.text, "<meta reminder>");

  const user = s.messages[1]!;
  assert.equal(user.isMeta, false);
  assert.equal(user.text, "Fix the auth bug");

  const asst = s.messages[2]!;
  assert.equal(asst.role, "assistant");
  assert.equal(asst.thinking, "the race is on the token");
  assert.equal(asst.text, "Let me read the file.");
  assert.equal(asst.toolUses.length, 1);
  assert.equal(asst.toolUses[0]!.name, "Read");
  assert.deepEqual(asst.toolUses[0]!.input, { path: "auth.ts" });

  const result = s.messages[3]!;
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0]!.toolUseId, "t1");
  assert.equal(result.toolResults[0]!.text, "file contents");
  assert.equal(result.toolResults[0]!.isError, false);

  const sys = s.messages[5]!;
  assert.equal(sys.role, "system");
  assert.equal(sys.text, "compacted");
});

test("raw stats: hash matches recompute, line count excludes trailing newline", () => {
  const raw = fixture();
  const s = parseClaudeCodeTranscript(raw);
  assert.equal(s.raw.hash, hashBytes(raw));
  assert.equal(s.raw.hash.length, 64);
  assert.equal(s.raw.bytes, Buffer.byteLength(raw, "utf8"));
  assert.equal(s.raw.lineCount, 8);
  // Every cited line is within range.
  for (const m of s.messages) assert.ok(m.line >= 1 && m.line <= s.raw.lineCount);
});

test("transcriptAttachment maps a session to a schema Attachment", () => {
  const s = parseClaudeCodeTranscript(fixture());
  const att = transcriptAttachment(s, "att-1");
  assert.deepEqual(att, {
    id: "att-1",
    kind: "transcript",
    contentHash: s.raw.hash,
    bytes: s.raw.bytes,
    blobRef: null,
  });
});

test("empty transcript yields a well-formed empty session", () => {
  const s = parseClaudeCodeTranscript("");
  assert.equal(s.messages.length, 0);
  assert.equal(s.raw.lineCount, 0);
  assert.equal(s.raw.hash, hashBytes(""));
});

// Integration: if real Claude Code transcripts exist on this machine, parse the
// newest one and assert invariants. Skipped cleanly where none are present.
test("parses a real Claude Code transcript when one is available", (t) => {
  const projects = join(homedir(), ".claude", "projects");
  if (!existsSync(projects)) return t.skip("no ~/.claude/projects on this machine");
  let file: string | undefined;
  for (const dir of readdirSync(projects)) {
    const full = join(projects, dir);
    const jsonl = (() => {
      try {
        return readdirSync(full).filter((f) => f.endsWith(".jsonl"));
      } catch {
        return [];
      }
    })();
    if (jsonl.length > 0) {
      file = join(full, jsonl[0]!);
      break;
    }
  }
  if (!file) return t.skip("no transcript files found");

  const s = captureClaudeCodeFile(file);
  assert.equal(s.tool, "claude-code");
  assert.equal(s.raw.hash.length, 64);
  assert.ok(s.messages.length > 0, "expected at least one parsed turn");
  for (const m of s.messages) assert.ok(m.line >= 1 && m.line <= s.raw.lineCount);
});
