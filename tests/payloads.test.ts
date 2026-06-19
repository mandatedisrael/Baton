import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PayloadEncryptor } from "../src/chain/encryption.ts";
import { encryptQueuedJob, loadPlaintextPayload } from "../src/chain/payloads.ts";
import { createUploadJob } from "../src/chain/queue.ts";
import { finalize } from "../src/core/finalize.ts";
import { hashBytes } from "../src/core/hash.ts";
import type { Attachment } from "../src/schema/handoff.ts";
import { encryptedPayloadPath } from "../src/store/paths.ts";
import { ProjectStore } from "../src/store/project.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-payload-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setup() {
  const store = ProjectStore.init(root);
  const source = Buffer.from("source transcript\n", "utf8");
  const attachment: Attachment = {
    id: "transcript-1",
    kind: "transcript",
    contentHash: hashBytes(source),
    bytes: source.byteLength,
    blobRef: null,
  };
  const { handoff, id } = finalize(store.loadWorkingState(), {
    projectId: store.config().projectId,
    author: "test",
    tool: "claude-code",
    captureMode: "transcript",
    parents: [],
    attachments: [attachment],
    timestamp: "2026-06-19T12:00:00.000Z",
  });
  store.saveAttachment(attachment, source);
  store.saveHandoff(handoff, id);
  store.enqueueUploadJob(createUploadJob(id, handoff, new Date("2026-06-19T12:00:00Z")));
  return { store, id, source };
}

test("loadPlaintextPayload returns canonical handoff and verified attachment bytes", () => {
  const { store, id, source } = setup();
  const job = store.loadUploadJob(id);
  const handoffBytes = loadPlaintextPayload(store, job, job.blobs[0]!);
  assert.equal(hashBytes(handoffBytes), id);
  assert.deepEqual(loadPlaintextPayload(store, job, job.blobs[1]!), source);
});

test("encryptQueuedJob checkpoints each encrypted payload durably", async () => {
  const { store, id } = setup();
  const seen: string[] = [];
  const encryptor: PayloadEncryptor = {
    async encrypt(request) {
      seen.push(request.identity);
      return Buffer.concat([Buffer.from("sealed:"), request.data]);
    },
  };

  const job = await encryptQueuedJob(
    store,
    id,
    encryptor,
    { packageId: "0x1234", threshold: 1 },
    new Date("2026-06-19T12:01:00Z"),
  );
  assert.equal(job.status, "uploading");
  assert.equal(job.attempts, 1);
  assert.ok(job.blobs.every((blob) => blob.status === "encrypted"));
  assert.equal(seen.length, 2);
  for (const blob of job.blobs) {
    assert.match(store.loadEncryptedPayload(job, blob.id).toString("utf8"), /^sealed:/);
  }
});

test("encryptQueuedJob preserves completed blobs when a later encryption fails", async () => {
  const { store, id } = setup();
  let calls = 0;
  const encryptor: PayloadEncryptor = {
    async encrypt(request) {
      calls += 1;
      if (calls === 2) throw new Error("key server unavailable");
      return Buffer.concat([Buffer.from("sealed:"), request.data]);
    },
  };
  const job = await encryptQueuedJob(store, id, encryptor, { packageId: "0x1234", threshold: 1 });
  assert.equal(job.status, "failed");
  assert.equal(job.lastError, "key server unavailable");
  assert.equal(job.blobs[0]!.status, "encrypted");
  assert.equal(job.blobs[1]!.status, "pending");
  assert.ok(store.loadEncryptedPayload(job, "handoff").byteLength > 0);
});

test("encrypted payload tampering is refused on read", async () => {
  const { store, id } = setup();
  const encryptor: PayloadEncryptor = {
    async encrypt(request) {
      return Buffer.concat([Buffer.from("sealed:"), request.data]);
    },
  };
  const job = await encryptQueuedJob(store, id, encryptor, { packageId: "0x1234", threshold: 1 });
  const blob = job.blobs[0]!;
  writeFileSync(encryptedPayloadPath(root, id, blob.contentHash), "tampered");
  assert.throws(() => store.loadEncryptedPayload(job, blob.id), /failed verification/);
});
