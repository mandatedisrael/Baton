import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPass } from "../src/cli/commands/pass.ts";
import { ProjectStore } from "../src/store/project.ts";

let root: string;
let previousApiKey: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-pass-test-"));
  previousApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previousApiKey;
  rmSync(root, { recursive: true, force: true });
});

function transcriptWithSecret(secret: string): string {
  return [
    JSON.stringify({
      type: "user",
      sessionId: "session-1",
      cwd: root,
      gitBranch: "main",
      message: { role: "user", content: `Use token ${secret}` },
      uuid: "user-1",
    }),
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", model: "claude-test", content: "Working on it" },
      uuid: "assistant-1",
      parentUuid: "user-1",
    }),
  ].join("\n") + "\n";
}

test("pass persists a scrubbed transcript that survives deletion of the source", async () => {
  const store = ProjectStore.init(root);
  const transcriptPath = join(root, "session.jsonl");
  const secret = `ghp_${"a".repeat(36)}`;
  writeFileSync(transcriptPath, transcriptWithSecret(secret));
  store.saveCursor({ sessionId: "session-1", line: 2, transcriptPath });

  await runPass(root);

  const head = store.config().head;
  assert.ok(head);
  const handoff = store.loadHandoff(head);
  assert.equal(handoff.meta.captureMode, "transcript");
  assert.equal(handoff.attachments.length, 1);
  const job = store.loadUploadJob(head);
  assert.equal(job.status, "pending");
  assert.deepEqual(job.blobs.map((blob) => blob.kind), ["handoff", "attachment"]);

  unlinkSync(transcriptPath);
  const saved = store.loadAttachment(handoff.attachments[0]!).toString("utf8");
  assert.doesNotMatch(saved, new RegExp(secret));
  assert.match(saved, /\[REDACTED:github-token\]/);
  assert.equal(saved.split("\n").length, 3, "scrubbing must preserve citation line numbers");
});

test("pass discovers, scrubs, and attaches the latest Codex project transcript", async () => {
  const store = ProjectStore.init(root);
  const sessionsRoot = join(root, "codex-sessions");
  const sessionDir = join(sessionsRoot, "2026", "06", "20");
  mkdirSync(sessionDir, { recursive: true });
  const secret = `ghp_${"b".repeat(36)}`;
  const transcriptPath = join(sessionDir, "rollout.jsonl");
  writeFileSync(transcriptPath, [
    JSON.stringify({ type: "session_meta", payload: {
      id: "codex-session", cwd: root, git: { branch: "main" },
    } }),
    JSON.stringify({ type: "turn_context", payload: { cwd: root, model: "gpt-5.5" } }),
    JSON.stringify({ type: "response_item", payload: {
      type: "message", role: "user", content: [{ type: "input_text", text: `Use token ${secret}` }],
    } }),
    JSON.stringify({ type: "response_item", payload: {
      type: "message", role: "assistant", content: [{ type: "output_text", text: "Working on it" }],
    } }),
  ].join("\n") + "\n");

  await runPass(root, { codexSessionsRoot: sessionsRoot });

  const head = store.config().head;
  assert.ok(head);
  const handoff = store.loadHandoff(head);
  assert.equal(handoff.meta.tool, "codex");
  assert.equal(handoff.meta.captureMode, "transcript");
  assert.equal(handoff.meta.model, "gpt-5.5");
  assert.equal(handoff.attachments.length, 1);
  const saved = store.loadAttachment(handoff.attachments[0]!).toString("utf8");
  assert.doesNotMatch(saved, new RegExp(secret));
  assert.match(saved, /\[REDACTED:github-token\]/);
});
