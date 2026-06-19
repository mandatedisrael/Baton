import { test } from "node:test";
import assert from "node:assert/strict";
import { renderQueueStatus } from "../src/render/queue.ts";
import type { UploadJob } from "../src/schema/remote.ts";

const HASH = "a".repeat(64);

function job(overrides: Partial<UploadJob> = {}): UploadJob {
  return {
    schemaVersion: 1,
    handoffId: HASH,
    status: "pending",
    attempts: 0,
    createdAt: "2026-06-19T12:00:00.000Z",
    updatedAt: "2026-06-19T12:00:00.000Z",
    lastError: null,
    blobs: [
      {
        id: "handoff",
        kind: "handoff",
        contentHash: HASH,
        status: "pending",
        encryptedHash: null,
        blobId: null,
      },
    ],
    anchor: { status: "pending", txDigest: null },
    ...overrides,
  };
}

test("renderQueueStatus handles an empty queue", () => {
  assert.equal(renderQueueStatus([]), "No batons queued for remote publication.\n");
});

test("renderQueueStatus summarizes progress and failures", () => {
  const output = renderQueueStatus([
    job(),
    job({
      handoffId: "b".repeat(64),
      status: "failed",
      attempts: 2,
      lastError: "Walrus unavailable",
      blobs: [
        {
          id: "handoff",
          kind: "handoff",
          contentHash: "b".repeat(64),
          status: "uploaded",
          encryptedHash: "c".repeat(64),
          blobId: "walrus-1",
        },
      ],
    }),
  ]);
  assert.match(output, /1 pending · 1 failed/);
  assert.match(output, /aaaaaaaaaaaa  pending\s+0\/1 blobs · 0 attempts/);
  assert.match(output, /bbbbbbbbbbbb  failed\s+1\/1 blobs · 2 attempts · Walrus unavailable/);
});
