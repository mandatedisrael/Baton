import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize } from "../src/core/canonical.ts";
import { finalize } from "../src/core/finalize.ts";
import { hashBytes } from "../src/core/hash.ts";
import { recoverRemoteHandoff, verifyRemoteHandoff } from "../src/chain/recovery.ts";
import type { PayloadDecryptor } from "../src/chain/decryption.ts";
import type { VerifiedRemoteManifest } from "../src/chain/manifest.ts";
import type { RemoteProjectConfig } from "../src/schema/project.ts";
import type { Attachment } from "../src/schema/handoff.ts";
import { ProjectStore } from "../src/store/project.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "baton-recovery-test-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const store = ProjectStore.init(root);
  const attachmentBytes = Buffer.from("source transcript\n");
  const attachment: Attachment = {
    id: "transcript-1",
    kind: "transcript",
    contentHash: hashBytes(attachmentBytes),
    bytes: attachmentBytes.length,
    blobRef: null,
  };
  const { handoff, id } = finalize(store.loadWorkingState(), {
    projectId: store.config().projectId,
    author: "test",
    tool: "codex",
    captureMode: "transcript",
    parents: [],
    branch: "main",
    attachments: [attachment],
    timestamp: "2026-06-19T12:00:00.000Z",
  });
  const manifest: VerifiedRemoteManifest = {
    handoffId: id,
    handoff: { id: "handoff", kind: "handoff", contentHash: id, blobId: "walrus-handoff-blob-id" },
    attachments: [{ id: attachment.id, kind: "attachment", contentHash: attachment.contentHash, blobId: "walrus-attachment-blob-id" }],
    branch: "main",
    parents: [],
    fidelityBps: null,
    graderModel: "",
    rubricVersion: 0,
    captureMode: 0,
    tool: 1,
    timestampMs: BigInt(Date.parse(handoff.meta.timestamp)),
    anchorTx: "anchor",
  };
  const remote = {
    network: "testnet",
    rpcUrl: "https://rpc.example",
    packageId: "0x1234",
    policyPackageId: "0x1234",
    projectObjectId: "0x5678",
    authority: { kind: "owner", capId: "0x9abc" },
    registrationTx: "register",
    registeredAt: "2026-06-19T00:00:00.000Z",
    seal: { threshold: 1, serverConfigs: [{ objectId: "0x1", weight: 1 }] },
    walrus: { epochs: 3, deletable: false, uploadRelayUrl: "https://relay.example", aggregatorUrl: "https://aggregator.example", maxTipMist: 1000 },
  } satisfies RemoteProjectConfig;
  const payloads = new Map([
    [manifest.handoff.blobId, Buffer.from(canonicalize(handoff))],
    [manifest.attachments[0]!.blobId, attachmentBytes],
  ]);
  const retriever = { fetch: async (blobId: string) => Buffer.from(`cipher:${blobId}`) };
  const decryptor: PayloadDecryptor = {
    async decrypt(request) {
      const blobId = request.data.toString().slice("cipher:".length);
      return payloads.get(blobId)!;
    },
  };
  return { store, handoff, id, attachment, attachmentBytes, manifest, remote, retriever, decryptor };
}

test("recoverRemoteHandoff authenticates the complete remote set before persisting", async () => {
  const f = fixture();
  const recovered = await recoverRemoteHandoff(f);
  assert.deepEqual(recovered, f.handoff);
  assert.deepEqual(f.store.loadHandoff(f.id), f.handoff);
  assert.deepEqual(f.store.loadAttachment(f.attachment), f.attachmentBytes);
});

test("verifyRemoteHandoff audits every payload without changing local state", async () => {
  const f = fixture();
  const verified = await verifyRemoteHandoff(f);
  assert.deepEqual(verified.handoff, f.handoff);
  assert.equal(verified.attachments.length, 1);
  assert.equal(verified.attachments[0]?.bytes.byteLength, f.attachmentBytes.byteLength);
  assert.throws(() => f.store.loadHandoff(f.id), /no handoff/);
  assert.throws(() => f.store.loadAttachment(f.attachment), /not available locally/);
});

test("recoverRemoteHandoff refuses manifest metadata substitution", async () => {
  const f = fixture();
  f.manifest.tool = 4;
  await assert.rejects(recoverRemoteHandoff(f), /metadata does not match/);
  assert.throws(() => f.store.loadHandoff(f.id), /no handoff/);
});

test("recoverRemoteHandoff persists nothing when an attachment fails verification", async () => {
  const f = fixture();
  let calls = 0;
  f.decryptor.decrypt = async () => {
    calls += 1;
    return calls === 2 ? Buffer.from("tampered") : Buffer.from(canonicalize(f.handoff));
  };
  await assert.rejects(recoverRemoteHandoff(f), /hashes to/);
  assert.throws(() => f.store.loadHandoff(f.id), /no handoff/);
  assert.throws(() => f.store.loadAttachment(f.attachment), /not available locally/);
});
