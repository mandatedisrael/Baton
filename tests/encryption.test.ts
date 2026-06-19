import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginEncryptionAttempt,
  encryptBlob,
  markBlobEncrypted,
  markPublicationFailed,
  sealAad,
  sealIdentity,
  type PayloadEncryptor,
} from "../src/chain/encryption.ts";
import { hashBytes } from "../src/core/hash.ts";
import type { UploadBlob, UploadJob } from "../src/schema/remote.ts";

const HANDOFF_ID = "a".repeat(64);
const PLAINTEXT = new TextEncoder().encode("baton payload");

function blob(): UploadBlob {
  return {
    id: "transcript-1",
    kind: "attachment",
    contentHash: hashBytes(PLAINTEXT),
    status: "pending",
    encryptedHash: null,
    blobId: null,
  };
}

function job(): UploadJob {
  return {
    schemaVersion: 1,
    handoffId: HANDOFF_ID,
    status: "pending",
    attempts: 0,
    createdAt: "2026-06-19T12:00:00.000Z",
    updatedAt: "2026-06-19T12:00:00.000Z",
    lastError: null,
    blobs: [
      {
        id: "handoff",
        kind: "handoff",
        contentHash: HANDOFF_ID,
        status: "pending",
        encryptedHash: null,
        blobId: null,
      },
      blob(),
    ],
    anchor: { status: "pending", txDigest: null },
  };
}

test("Seal identity and AAD bind ciphertext to its queue slot", () => {
  const target = blob();
  assert.equal(sealIdentity("0x1234", target), `0x${"1234".padStart(64, "0")}${target.contentHash}`);
  assert.equal(
    new TextDecoder().decode(sealAad("0x1234", HANDOFF_ID, target)),
    `baton:v1:0x1234:${HANDOFF_ID}:attachment:transcript-1:${target.contentHash}`,
  );
});

test("beginEncryptionAttempt advances retry bookkeeping", () => {
  const next = beginEncryptionAttempt(job(), new Date("2026-06-19T12:01:00Z"));
  assert.equal(next.status, "uploading");
  assert.equal(next.attempts, 1);
  assert.equal(next.updatedAt, "2026-06-19T12:01:00.000Z");
});

test("encryptBlob verifies plaintext before crossing the provider boundary", async () => {
  let request: Parameters<PayloadEncryptor["encrypt"]>[0] | undefined;
  const fake: PayloadEncryptor = {
    async encrypt(input) {
      request = input;
      return new Uint8Array([9, 8, 7]);
    },
  };
  const encrypted = await encryptBlob(
    fake,
    { packageId: "0x1234", projectObjectId: "0x5678", threshold: 2 },
    HANDOFF_ID,
    blob(),
    PLAINTEXT,
  );
  assert.deepEqual(encrypted, new Uint8Array([9, 8, 7]));
  assert.equal(request?.identity, `0x${"5678".padStart(64, "0")}${hashBytes(PLAINTEXT)}`);
  assert.equal(request?.threshold, 2);
  await assert.rejects(
    () =>
      encryptBlob(
        fake,
        { packageId: "0x1234", projectObjectId: "0x5678", threshold: 2 },
        HANDOFF_ID,
        blob(),
        new Uint8Array([0]),
      ),
    /refusing to encrypt/,
  );
});

test("markBlobEncrypted records ciphertext integrity and preserves other blobs", () => {
  const started = beginEncryptionAttempt(job());
  const encrypted = new Uint8Array([4, 5, 6]);
  const next = markBlobEncrypted(started, "transcript-1", encrypted);
  assert.equal(next.blobs[0]!.status, "pending");
  assert.equal(next.blobs[1]!.status, "encrypted");
  assert.equal(next.blobs[1]!.encryptedHash, hashBytes(encrypted));
});

test("markPublicationFailed preserves progress and records the error", () => {
  const started = beginEncryptionAttempt(job());
  const failed = markPublicationFailed(started, new Error("key server unavailable"));
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.lastError, "key server unavailable");
});
