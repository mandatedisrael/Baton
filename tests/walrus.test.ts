import { test } from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { WriteBlobStep } from "@mysten/walrus";
import { blobIdFromInt } from "@mysten/walrus";
import { BatonError } from "../src/core/errors.ts";
import { reconcileCertifiedUpload, runWalrusWriteFlow } from "../src/chain/walrus.ts";

function flow(steps: WriteBlobStep[]) {
  return {
    async *run() {
      for (const step of steps) yield step;
    },
  };
}

test("runWalrusWriteFlow checkpoints paid work and requires certification", async () => {
  const seen: string[] = [];
  const result = await runWalrusWriteFlow(
    flow([
      { step: "encoded", blobId: "blob-1", rootHash: "root", unencodedSize: 5 },
      { step: "registered", blobId: "blob-1", blobObjectId: "0x1", txDigest: "register" },
      {
        step: "uploaded",
        blobId: "blob-1",
        blobObjectId: "0x1",
        txDigest: "register",
        certificate: "certificate",
      },
      { step: "certified", blobId: "blob-1", blobObjectId: "0x1", blobObject: {} as never },
    ]),
    {
      keypair: new Ed25519Keypair(),
      epochs: 3,
      deletable: false,
      onCheckpoint: (step) => {
        seen.push(step.step);
      },
    },
  );
  assert.deepEqual(seen, ["encoded", "registered", "uploaded"]);
  assert.equal(result.blobId, "blob-1");
});

test("runWalrusWriteFlow refuses an uncertified write", async () => {
  await assert.rejects(
    runWalrusWriteFlow(
      flow([{ step: "encoded", blobId: "blob-1", rootHash: "root", unencodedSize: 5 }]),
      {
        keypair: new Ed25519Keypair(),
        epochs: 3,
        deletable: false,
        onCheckpoint: () => {},
      },
    ),
    (err: unknown) => err instanceof BatonError && /before blob certification/.test(err.message),
  );
});

test("runWalrusWriteFlow awaits durable checkpoint callbacks", async () => {
  const order: string[] = [];
  await runWalrusWriteFlow(
    flow([
      { step: "encoded", blobId: "blob-1", rootHash: "root", unencodedSize: 5 },
      { step: "certified", blobId: "blob-1", blobObjectId: "0x1", blobObject: {} as never },
    ]),
    {
      keypair: new Ed25519Keypair(),
      epochs: 3,
      deletable: false,
      onCheckpoint: async () => {
        await Promise.resolve();
        order.push("saved");
      },
    },
  );
  assert.deepEqual(order, ["saved"]);
});

test("reconcileCertifiedUpload treats an already-certified uploaded checkpoint as complete", async () => {
  const blobId = blobIdFromInt("1");
  const resume = {
    step: "uploaded" as const,
    blobId,
    blobObjectId: "0x1",
    txDigest: "register",
    certificate: "certificate",
  };
  assert.deepEqual(
    await reconcileCertifiedUpload(resume, async () => ({ blob_id: "1", certified_epoch: 42 })),
    { blobId },
  );
  assert.equal(
    await reconcileCertifiedUpload(resume, async () => ({ blob_id: "1", certified_epoch: null })),
    null,
  );
  await assert.rejects(
    () => reconcileCertifiedUpload(resume, async () => ({ blob_id: "2", certified_epoch: 42 })),
    /identity changed/,
  );
});
