import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnchorTransaction, extractExistingAnchor } from "../src/chain/anchor.ts";
import { createUploadJob } from "../src/chain/queue.ts";
import { finalize } from "../src/core/finalize.ts";
import type { RemoteProjectConfig } from "../src/schema/project.ts";
import { ProjectStore } from "../src/store/project.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const remote: RemoteProjectConfig = {
  network: "testnet",
  rpcUrl: "https://fullnode.testnet.sui.io:443",
  packageId: "0x1234",
  projectObjectId: "0x5678",
  authority: { kind: "owner", capId: "0x9abc" },
  registrationTx: "registration",
  registeredAt: "2026-06-19T12:00:00.000Z",
  seal: { threshold: 1, serverConfigs: [{ objectId: "0x1", weight: 1 }] },
  walrus: {
    epochs: 3,
    deletable: false,
    uploadRelayUrl: "https://relay.example",
    aggregatorUrl: "https://aggregator.example",
    maxTipMist: 1000,
  },
};

function uploadedFixture() {
  const root = mkdtempSync(join(tmpdir(), "baton-anchor-test-"));
  const store = ProjectStore.init(root);
  const { handoff, id } = finalize(store.loadWorkingState(), {
    projectId: store.config().projectId,
    author: "test",
    tool: "codex",
    captureMode: "fallback",
    parents: [],
    branch: "main",
    timestamp: "2026-06-19T12:00:00.000Z",
  });
  const pending = createUploadJob(id, handoff);
  const job = {
    ...pending,
    status: "anchoring" as const,
    blobs: pending.blobs.map((blob) => ({
      ...blob,
      status: "uploaded" as const,
      encryptedHash: "b".repeat(64),
      blobId: "walrus-handoff",
      walrus: { step: "uploaded" as const, blobId: "walrus-handoff", blobObjectId: "0x1", certificate: "cert" },
    })),
  };
  return { root, handoff, id, job };
}

test("buildAnchorTransaction targets the deployed contract with complete manifest metadata", () => {
  const fixture = uploadedFixture();
  try {
    const tx = buildAnchorTransaction({ remote, handoffId: fixture.id, handoff: fixture.handoff, job: fixture.job });
    const call = tx.getData().commands[0];
    assert.equal(call?.$kind, "MoveCall");
    if (call?.$kind === "MoveCall") {
      assert.equal(call.MoveCall.function, "anchor_handoff");
      assert.equal(call.MoveCall.module, "memory");
      assert.equal(call.MoveCall.arguments.length, 16);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("buildAnchorTransaction refuses unpublished payloads", () => {
  const fixture = uploadedFixture();
  try {
    (fixture.job.blobs[0] as { status: string }).status = "encrypted";
    assert.throws(
      () => buildAnchorTransaction({ remote, handoffId: fixture.id, handoff: fixture.handoff, job: fixture.job }),
      /certified on Walrus/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("extractExistingAnchor verifies interrupted on-chain completion", () => {
  const hash = "a".repeat(64);
  const response = {
    data: {
      objectId: "0xfield",
      version: "1",
      digest: "digest",
      type: "0x2::dynamic_field::Field",
      owner: { ObjectOwner: "0xproject" },
      previousTransaction: "anchor-tx",
      storageRebate: "0",
      content: {
        dataType: "moveObject" as const,
        type: "0x2::dynamic_field::Field",
        hasPublicTransfer: false,
        fields: {
          name: { fields: { hash: [...Buffer.from(hash, "hex")] } },
          value: { fields: { handoff_blob_id: [...Buffer.from("walrus-handoff")] } },
        },
      },
    },
  } as never;
  assert.equal(extractExistingAnchor(response, hash, "walrus-handoff"), "anchor-tx");
  assert.throws(() => extractExistingAnchor(response, hash, "different"), /different Walrus blob/);
});
