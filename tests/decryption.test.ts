import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptBlob, type PayloadDecryptor, type RemoteBlobDescriptor } from "../src/chain/decryption.ts";
import { buildSealApprovalTransaction } from "../src/chain/seal.ts";
import { hashBytes } from "../src/core/hash.ts";

const plaintext = Buffer.from("verified remote baton");
const HANDOFF_ID = "f".repeat(64);
const blob: RemoteBlobDescriptor = {
  id: "handoff",
  kind: "handoff",
  contentHash: hashBytes(plaintext),
  blobId: "IxAzdh40gIAqQB8g9_DG7eT6dQcLjHIUXykzIvUoYFM",
};

test("decryptBlob binds policy identity and verifies recovered plaintext", async () => {
  let identity = "";
  const decryptor: PayloadDecryptor = {
    async decrypt(request) {
      identity = request.identity;
      return plaintext;
    },
  };
  assert.deepEqual(
    await decryptBlob({
      decryptor,
      packageId: "0x1234",
      projectObjectId: "0x5678",
      ownerCapId: "0x9abc",
      handoffId: HANDOFF_ID,
      blob,
      ciphertext: Uint8Array.from([1, 2, 3]),
    }),
    plaintext,
  );
  assert.equal(identity, `0x${"5678".padStart(64, "0")}${HANDOFF_ID}`);
});

test("decryptBlob refuses plaintext that differs from the manifest hash", async () => {
  const decryptor: PayloadDecryptor = { decrypt: async () => Buffer.from("tampered") };
  await assert.rejects(
    decryptBlob({
      decryptor,
      packageId: "0x1234",
      projectObjectId: "0x5678",
      ownerCapId: "0x9abc",
      handoffId: HANDOFF_ID,
      blob,
      ciphertext: Uint8Array.from([1]),
    }),
    /hashes to/,
  );
});

test("buildSealApprovalTransaction calls the owner-gated Baton policy", () => {
  const tx = buildSealApprovalTransaction({
    packageId: "0x1234",
    projectObjectId: "0x5678",
    ownerCapId: "0x9abc",
    identity: `0x${"00".repeat(64)}`,
  });
  const call = tx.getData().commands[0];
  assert.equal(call?.$kind, "MoveCall");
  if (call?.$kind === "MoveCall") {
    assert.equal(call.MoveCall.function, "seal_approve");
    assert.equal(call.MoveCall.arguments.length, 3);
  }
});
