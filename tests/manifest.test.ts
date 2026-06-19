import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRemoteManifestResponse } from "../src/chain/manifest.ts";
import type { RemoteProjectConfig } from "../src/schema/project.ts";

const PACKAGE = "0x74020a1a00779799768a5145bd2734f3e724d2826c5e8d610f345c2c036b090e";
const PROJECT = "0xa0dd123b2ec564d7502688f751f360e9ef3f7d18f4cd73a6e671afdf3c0acaa4";
const HASH = "63d1d21152a2280cff510906dd9ffeadc6dae64ad99eef4f40979ed8ec8d4e76";
const remote = {
  network: "testnet",
  rpcUrl: "https://rpc.example",
  packageId: PACKAGE,
  policyPackageId: PACKAGE,
  projectObjectId: PROJECT,
  authority: { kind: "owner", capId: "0x1" },
  registrationTx: "register",
  registeredAt: "2026-06-19T00:00:00.000Z",
  seal: { threshold: 1, serverConfigs: [{ objectId: "0x2", weight: 1 }] },
  walrus: {
    epochs: 3,
    deletable: false,
    uploadRelayUrl: "https://relay.example",
    aggregatorUrl: "https://aggregator.example",
    maxTipMist: 1000,
  },
} satisfies RemoteProjectConfig;

function response() {
  const type = `0x2::dynamic_field::Field<${PACKAGE}::memory::ManifestKey, ${PACKAGE}::memory::HandoffManifest>`;
  return {
    data: {
      objectId: "0xfield",
      version: "1",
      digest: "digest",
      type,
      owner: { ObjectOwner: PROJECT },
      previousTransaction: "anchor-tx",
      storageRebate: "0",
      content: {
        dataType: "moveObject" as const,
        type,
        hasPublicTransfer: false,
        fields: {
          name: { fields: { hash: [...Buffer.from(HASH, "hex")] } },
          value: {
            fields: {
              version: 1,
              branch: [...Buffer.from("main")],
              handoff_blob_id: [...Buffer.from("walrus-handoff")],
              parent_hashes: [[...Buffer.from("a".repeat(64), "hex")]],
              fidelity_bps: 9300,
              grader_model: [...Buffer.from("grader")],
              rubric_version: 1,
              capture_mode: 0,
              tool: 1,
              timestamp_ms: "1781866157004",
              attachments: [{
                fields: {
                  id: [...Buffer.from("transcript-1")],
                  blob_id: [...Buffer.from("walrus-attachment")],
                  content_hash: [...Buffer.from("b".repeat(64), "hex")],
                },
              }],
            },
          },
        },
      },
    },
  } as never;
}

test("parseRemoteManifestResponse verifies and maps the anchored manifest", () => {
  const manifest = parseRemoteManifestResponse({ response: response(), remote, handoffId: HASH });
  assert.equal(manifest.handoff.blobId, "walrus-handoff");
  assert.equal(manifest.attachments[0]!.contentHash, "b".repeat(64));
  assert.deepEqual(manifest.parents, ["a".repeat(64)]);
  assert.equal(manifest.fidelityBps, 9300);
  assert.equal(manifest.anchorTx, "anchor-tx");
});

test("parseRemoteManifestResponse rejects project, key, and blob metadata substitution", () => {
  const wrongOwner = response() as any;
  wrongOwner.data.owner.ObjectOwner = "0xother";
  assert.throws(() => parseRemoteManifestResponse({ response: wrongOwner, remote, handoffId: HASH }), /not owned/);

  const wrongHash = response() as any;
  wrongHash.data.content.fields.name.fields.hash[0] ^= 1;
  assert.throws(() => parseRemoteManifestResponse({ response: wrongHash, remote, handoffId: HASH }), /does not match/);

  const badAttachment = response() as any;
  badAttachment.data.content.fields.value.fields.attachments[0].fields.content_hash = [1, 2];
  assert.throws(() => parseRemoteManifestResponse({ response: badAttachment, remote, handoffId: HASH }), /32 bytes/);
});
