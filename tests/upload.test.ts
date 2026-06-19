import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markBlobEncrypted } from "../src/chain/encryption.ts";
import { createUploadJob } from "../src/chain/queue.ts";
import { uploadQueuedJob } from "../src/chain/upload.ts";
import type { WalrusUploader } from "../src/chain/walrus.ts";
import { finalize } from "../src/core/finalize.ts";
import { ProjectStore } from "../src/store/project.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-upload-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setup() {
  const store = ProjectStore.init(root);
  const { handoff, id } = finalize(store.loadWorkingState(), {
    projectId: store.config().projectId,
    author: "test",
    tool: "other",
    captureMode: "fallback",
    parents: [],
    timestamp: "2026-06-19T12:00:00.000Z",
  });
  store.saveHandoff(handoff, id);
  let job = createUploadJob(id, handoff, new Date("2026-06-19T12:00:00Z"));
  const encrypted = Buffer.from("real ciphertext bytes");
  job = markBlobEncrypted(job, "handoff", encrypted);
  store.saveEncryptedPayload(job, "handoff", encrypted);
  store.saveUploadJob(job);
  return { store, id };
}

function successfulUploader(seenResume: Array<string | null> = []): WalrusUploader {
  return {
    async upload(input) {
      seenResume.push(input.resume?.step ?? null);
      await input.onCheckpoint({ step: "encoded", blobId: "walrus-1", rootHash: "root", unencodedSize: input.data.length });
      await input.onCheckpoint({ step: "registered", blobId: "walrus-1", blobObjectId: "0x1", txDigest: "register" });
      await input.onCheckpoint({ step: "uploaded", blobId: "walrus-1", blobObjectId: "0x1", txDigest: "register", certificate: "certificate" });
      return { blobId: "walrus-1" };
    },
  };
}

test("uploadQueuedJob checkpoints and certifies encrypted payloads", async () => {
  const { store, id } = setup();
  const job = await uploadQueuedJob(store, id, successfulUploader(), new Date("2026-06-19T12:01:00Z"));
  assert.equal(job.status, "anchoring");
  assert.equal(job.blobs[0]!.status, "uploaded");
  assert.equal(job.blobs[0]!.blobId, "walrus-1");
  assert.equal(store.loadUploadJob(id).blobs[0]!.walrus?.step, "uploaded");
});

test("uploadQueuedJob resumes from the last durable Walrus checkpoint", async () => {
  const { store, id } = setup();
  const interrupted: WalrusUploader = {
    async upload(input) {
      await input.onCheckpoint({ step: "encoded", blobId: "walrus-1", rootHash: "root", unencodedSize: input.data.length });
      throw new Error("process interrupted");
    },
  };
  const failed = await uploadQueuedJob(store, id, interrupted);
  assert.equal(failed.status, "failed");
  assert.equal(failed.blobs[0]!.walrus?.step, "encoded");

  const seen: Array<string | null> = [];
  const completed = await uploadQueuedJob(store, id, successfulUploader(seen));
  assert.equal(completed.status, "anchoring");
  assert.deepEqual(seen, ["encoded"]);
});

test("uploadQueuedJob refuses plaintext queue entries", async () => {
  const store = ProjectStore.init(root);
  const { handoff, id } = finalize(store.loadWorkingState(), {
    projectId: store.config().projectId,
    author: "test",
    tool: "other",
    captureMode: "fallback",
    parents: [],
  });
  store.saveHandoff(handoff, id);
  store.saveUploadJob(createUploadJob(id, handoff));
  await assert.rejects(uploadQueuedJob(store, id, successfulUploader()), /must be encrypted/);
});
