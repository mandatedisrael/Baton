import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRemoteSidecar, parseUploadJob } from "../src/schema/remote.ts";

const HASH = "a".repeat(64);
const ATTACHMENT_HASH = "b".repeat(64);

function job() {
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
        walrus: null,
      },
      {
        id: "transcript-1",
        kind: "attachment",
        contentHash: ATTACHMENT_HASH,
        status: "uploaded",
        encryptedHash: "c".repeat(64),
        blobId: "walrus-attachment",
        walrus: {
          step: "uploaded",
          blobId: "walrus-attachment",
          blobObjectId: "0x123",
          certificate: "certificate",
        },
      },
    ],
    anchor: { status: "pending", txDigest: null },
  };
}

test("parseUploadJob accepts resumable per-blob progress", () => {
  const parsed = parseUploadJob(job());
  assert.equal(parsed.handoffId, HASH);
  assert.equal(parsed.blobs[1]!.status, "uploaded");
});

test("parseUploadJob rejects unknown keys and malformed hashes", () => {
  assert.throws(() => parseUploadJob({ ...job(), surprise: true }), /unknown key/);
  assert.throws(() => parseUploadJob({ ...job(), handoffId: "not-a-hash" }), /64 lowercase hex/);
});

test("parseUploadJob requires exactly one handoff blob", () => {
  assert.throws(() => parseUploadJob({ ...job(), blobs: job().blobs.slice(1) }), /exactly one handoff/);
});

test("parseUploadJob rejects invalid status and retry metadata", () => {
  assert.throws(() => parseUploadJob({ ...job(), status: "done" }), /expected one of/);
  assert.throws(() => parseUploadJob({ ...job(), attempts: -1 }), /expected >= 0/);
});

test("parseUploadJob rejects impossible blob and completion states", () => {
  const pendingWithBlobId = job();
  pendingWithBlobId.blobs[0]!.blobId = "too-early";
  assert.throws(() => parseUploadJob(pendingWithBlobId), /pending blob cannot/);

  const prematureComplete = job();
  prematureComplete.status = "complete";
  assert.throws(() => parseUploadJob(prematureComplete), /requires every blob to be uploaded/);
});

test("parseUploadJob binds the handoff blob to the baton id", () => {
  const mismatched = job();
  mismatched.blobs[0]!.contentHash = "d".repeat(64);
  assert.throws(() => parseUploadJob(mismatched), /baton content hash/);
});

test("parseUploadJob preserves recoverable Walrus write checkpoints", () => {
  const value = job();
  value.blobs[0]!.status = "encrypted";
  value.blobs[0]!.encryptedHash = "d".repeat(64);
  value.blobs[0]!.walrus = {
    step: "registered",
    blobId: "walrus-handoff",
    blobObjectId: "0x456",
    txDigest: "register-tx",
  } as unknown as typeof value.blobs[1]["walrus"];
  const parsed = parseUploadJob(value);
  assert.equal(parsed.blobs[0]!.walrus?.step, "registered");
});

test("parseUploadJob migrates queues written before Walrus checkpoints", () => {
  const value = job();
  for (const blob of value.blobs) delete (blob as Partial<typeof blob>).walrus;
  const parsed = parseUploadJob(value);
  assert.equal(parsed.blobs[0]!.walrus, null);
});

test("parseUploadJob rejects a completed blob with mismatched Walrus identity", () => {
  const value = job();
  value.blobs[1]!.walrus!.blobId = "different-blob";
  assert.throws(() => parseUploadJob(value), /must match the completed blob id/);
});

test("parseRemoteSidecar accepts completed Walrus and Sui metadata", () => {
  const sidecar = parseRemoteSidecar({
    schemaVersion: 1,
    handoffId: HASH,
    handoffBlobId: "walrus-handoff",
    attachments: [{ id: "transcript-1", contentHash: ATTACHMENT_HASH, blobId: "walrus-attachment" }],
    anchor: {
      network: "testnet",
      projectObjectId: "0x123",
      txDigest: "tx-digest",
      anchoredAt: "2026-06-19T12:05:00.000Z",
    },
  });
  assert.equal(sidecar.anchor.network, "testnet");
  assert.equal(sidecar.attachments[0]!.contentHash, ATTACHMENT_HASH);
});

test("parseRemoteSidecar is strict", () => {
  assert.throws(
    () =>
      parseRemoteSidecar({
        schemaVersion: 1,
        handoffId: HASH,
        handoffBlobId: "walrus-handoff",
        attachments: [],
        anchor: {
          network: "testnet",
          projectObjectId: "0x123",
          txDigest: "tx",
          anchoredAt: "not-a-date",
        },
      }),
    /expected ISO 8601/,
  );
});
