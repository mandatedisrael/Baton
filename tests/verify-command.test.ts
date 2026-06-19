import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verificationEvidence } from "../src/cli/commands/verify.ts";
import { finalize } from "../src/core/finalize.ts";
import { hashBytes } from "../src/core/hash.ts";
import { applyPatch } from "../src/core/working-state.ts";
import type { Attachment } from "../src/schema/handoff.ts";
import { ProjectStore } from "../src/store/project.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-verify-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("verificationEvidence resolves the head and reads hash-verified source lines", () => {
  const store = ProjectStore.init(root);
  const source = "first\nsource claim\nlast\n";
  const attachment: Attachment = {
    id: "transcript-1",
    kind: "transcript",
    contentHash: hashBytes(source),
    bytes: Buffer.byteLength(source),
    blobRef: null,
  };
  const state = applyPatch(store.loadWorkingState(), {
    kind: "add_decision",
    decision: {
      id: "d1",
      choice: "keep the source",
      rationale: "claims remain recoverable",
      citation: { attachmentId: attachment.id, fromLine: 2, toLine: 2 },
    },
  });
  const { handoff, id } = finalize(state, {
    projectId: store.config().projectId,
    author: "test",
    tool: "claude-code",
    captureMode: "transcript",
    parents: [],
    attachments: [attachment],
    timestamp: "2026-06-19T00:00:00.000Z",
  });
  store.saveAttachment(attachment, source);
  store.saveHandoff(handoff, id);
  store.setHead(id);

  const evidence = verificationEvidence(root, "d1");
  assert.match(evidence, /decision d1: keep the source/);
  assert.match(evidence, /source transcript-1, lines 2-2 \(verified\)/);
  assert.match(evidence, /2: source claim/);
});
