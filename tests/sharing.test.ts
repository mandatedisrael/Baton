import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils";
import {
  buildGrantAccessTransaction,
  buildRevokeAccessTransaction,
  extractGrantedAccessCap,
  verifyDelegatedAccess,
} from "../src/chain/sharing.ts";
import type { RemoteProjectConfig } from "../src/schema/project.ts";

const PACKAGE = "0x1234";
const PROJECT = "0x5678";
const GRANTEE = normalizeSuiAddress("0xcafe");
const remote: RemoteProjectConfig = {
  network: "testnet",
  rpcUrl: "https://rpc.example",
  packageId: PACKAGE,
  projectObjectId: PROJECT,
  authority: { kind: "owner", capId: "0x9abc" },
  registrationTx: "register",
  registeredAt: "2026-06-19T00:00:00.000Z",
  seal: { threshold: 1, serverConfigs: [{ objectId: "0x1", weight: 1 }] },
  walrus: {
    epochs: 3,
    deletable: false,
    uploadRelayUrl: "https://relay.example",
    aggregatorUrl: "https://aggregator.example",
    maxTipMist: 1000,
  },
};

test("sharing transactions call the owner-controlled contract functions", () => {
  const grant = buildGrantAccessTransaction(remote, GRANTEE).getData().commands[0];
  const revoke = buildRevokeAccessTransaction(remote, GRANTEE).getData().commands[0];
  assert.equal(grant?.$kind, "MoveCall");
  assert.equal(revoke?.$kind, "MoveCall");
  if (grant?.$kind === "MoveCall") assert.equal(grant.MoveCall.function, "grant_access");
  if (revoke?.$kind === "MoveCall") assert.equal(revoke.MoveCall.function, "revoke_access");
});

test("delegated readers cannot grant or revoke access", () => {
  const delegated = { ...remote, authority: { kind: "delegate", capId: "0xdef0" } } satisfies RemoteProjectConfig;
  assert.throws(() => buildGrantAccessTransaction(delegated, GRANTEE), /only the project owner/);
  assert.throws(() => buildRevokeAccessTransaction(delegated, GRANTEE), /only the project owner/);
});

test("extractGrantedAccessCap requires a recipient-owned AccessCap", () => {
  const packageId = normalizeSuiObjectId(PACKAGE);
  const changes = [{
    type: "created" as const,
    sender: "0x1",
    owner: { AddressOwner: GRANTEE },
    objectType: `${packageId}::memory::AccessCap`,
    objectId: "0xcap",
    version: "1",
    digest: "digest",
  }];
  assert.equal(extractGrantedAccessCap(PACKAGE, GRANTEE, changes), "0xcap");
  assert.throws(() => extractGrantedAccessCap(PACKAGE, "0xbeef", changes), /did not create/);
});

test("verifyDelegatedAccess checks ownership and the live generation", async () => {
  const delegated = { ...remote, authority: { kind: "delegate", capId: "0xdef0" } } satisfies RemoteProjectConfig;
  let active = true;
  const client = {
    async getObject() {
      return {
        data: {
          type: `${normalizeSuiObjectId(PACKAGE)}::memory::AccessCap`,
          owner: { AddressOwner: GRANTEE },
          content: {
            dataType: "moveObject",
            fields: { project: PROJECT, grantee: GRANTEE, generation: "2" },
          },
        },
      };
    },
    async getDynamicFieldObject() {
      return {
        data: {
          content: {
            dataType: "moveObject",
            fields: { value: { fields: { active, generation: "2" } } },
          },
        },
      };
    },
  };
  await verifyDelegatedAccess({ client: client as never, remote: delegated, grantee: GRANTEE });
  active = false;
  await assert.rejects(
    verifyDelegatedAccess({ client: client as never, remote: delegated, grantee: GRANTEE }),
    /revoked or superseded/,
  );
});
