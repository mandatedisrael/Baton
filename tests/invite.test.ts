import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShareInvitation } from "../src/schema/invite.ts";

function invitation() {
  return {
    schemaVersion: 1,
    projectId: "project-1",
    grantee: "0xcafe",
    head: "a".repeat(64),
    grantTx: "grant-transaction",
    grantedAt: "2026-06-19T12:00:00.000Z",
    remote: {
      network: "testnet",
      rpcUrl: "https://rpc.example",
      packageId: "0x1234",
      projectObjectId: "0x5678",
      authority: { kind: "delegate", capId: "0x9abc" },
      registrationTx: "register-transaction",
      registeredAt: "2026-06-19T11:00:00.000Z",
      seal: { threshold: 1, serverConfigs: [{ objectId: "0x1", weight: 1 }] },
      walrus: {
        epochs: 3,
        deletable: false,
        uploadRelayUrl: "https://relay.example",
        aggregatorUrl: "https://aggregator.example",
        maxTipMist: 1000,
      },
    },
  };
}

test("parseShareInvitation accepts bounded delegated project metadata", () => {
  const parsed = parseShareInvitation(invitation());
  assert.equal(parsed.remote.authority.kind, "delegate");
  assert.equal(parsed.head, "a".repeat(64));
  assert.match(parsed.grantee, /^0x[a-f0-9]{64}$/);
});

test("parseShareInvitation rejects owner authority, short heads, and unknown fields", () => {
  const owner = invitation();
  owner.remote.authority.kind = "owner";
  assert.throws(() => parseShareInvitation(owner), /must be delegated/);
  const short = invitation();
  short.head = "abc";
  assert.throws(() => parseShareInvitation(short), /full lowercase baton id/);
  assert.throws(() => parseShareInvitation({ ...invitation(), secretKey: "never" }), /unknown key/);
});
