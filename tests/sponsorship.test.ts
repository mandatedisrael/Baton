import { test } from "node:test";
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, normalizeSuiObjectId, toBase64 } from "@mysten/sui/utils";
import {
  buildSponsoredRegistrationBytes,
  reconcileSponsoredRegistration,
  sponsoredTransactionDigest,
  verifySponsoredRegistrationEnvelope,
  type SponsoredRegistrationEnvelope,
} from "../src/chain/sponsorship.ts";

const PACKAGE = "0x1234";
const USER = new Ed25519Keypair().toSuiAddress();
const SPONSOR = new Ed25519Keypair().toSuiAddress();
const GAS = [{ objectId: "0x99", version: "1", digest: "2E3Wu14rQZ4rqfSi8Ve1arY4HWd1wv2cZmJbdatMgv2p" }];

async function envelope(): Promise<SponsoredRegistrationEnvelope> {
  const bytes = await buildSponsoredRegistrationBytes({
    packageId: PACKAGE,
    projectId: "project-1",
    sender: USER,
    sponsor: SPONSOR,
    gasPrice: 1000n,
    gasPayment: GAS,
    expirationEpoch: 1200n,
  });
  return {
    requestId: "request-1",
    transactionBytes: toBase64(bytes),
    sponsor: SPONSOR,
    gasPrice: "1000",
    gasBudget: "50000000",
    gasPayment: GAS,
    expirationEpoch: "1200",
    expiresAt: "2026-06-19T13:00:00.000Z",
  };
}

test("sponsored registration bytes are deterministic for both signers", async () => {
  const first = await buildSponsoredRegistrationBytes({
    packageId: PACKAGE,
    projectId: "project-1",
    sender: USER,
    sponsor: SPONSOR,
    gasPrice: 1000n,
    gasPayment: GAS,
    expirationEpoch: 1200n,
  });
  const second = await buildSponsoredRegistrationBytes({
    packageId: PACKAGE,
    projectId: "project-1",
    sender: USER,
    sponsor: SPONSOR,
    gasPrice: 1000n,
    gasPayment: GAS,
    expirationEpoch: 1200n,
  });
  assert.deepEqual(first, second);
});

test("user verifies the complete sponsor transaction before signing", async () => {
  const value = await envelope();
  const verified = await verifySponsoredRegistrationEnvelope({
    envelope: value,
    packageId: PACKAGE,
    projectId: "project-1",
    sender: USER,
    now: new Date("2026-06-19T12:00:00.000Z"),
  });
  assert.deepEqual(verified, fromBase64(value.transactionBytes));
});

test("user refuses sponsor substitution, tampering, expiry, and excessive gas", async () => {
  const value = await envelope();
  await assert.rejects(
    verifySponsoredRegistrationEnvelope({
      envelope: value,
      packageId: PACKAGE,
      projectId: "different-project",
      sender: USER,
      now: new Date("2026-06-19T12:00:00.000Z"),
    }),
    /does not exactly match/,
  );
  const tampered = { ...value, transactionBytes: toBase64(Uint8Array.from([...fromBase64(value.transactionBytes), 0])) };
  await assert.rejects(
    verifySponsoredRegistrationEnvelope({ envelope: tampered, packageId: PACKAGE, projectId: "project-1", sender: USER, now: new Date("2026-06-19T12:00:00.000Z") }),
    /does not exactly match/,
  );
  await assert.rejects(
    verifySponsoredRegistrationEnvelope({ envelope: value, packageId: PACKAGE, projectId: "project-1", sender: USER, now: new Date("2026-06-19T14:00:00.000Z") }),
    /expired/,
  );
  await assert.rejects(
    verifySponsoredRegistrationEnvelope({ envelope: { ...value, gasBudget: "50000001" }, packageId: PACKAGE, projectId: "project-1", sender: USER, now: new Date("2026-06-19T12:00:00.000Z") }),
    /gas budget/,
  );
});

test("interrupted sponsored execution is reconciled by deterministic transaction digest", async () => {
  const value = await envelope();
  const bytes = fromBase64(value.transactionBytes);
  const digest = await sponsoredTransactionDigest(bytes);
  const normalized = normalizeSuiObjectId(PACKAGE);
  let requested = "";
  const result = await reconcileSponsoredRegistration({
    client: {
      async getTransactionBlock(input: { digest: string }) {
        requested = input.digest;
        return {
          digest,
          effects: { status: { status: "success" } },
          objectChanges: [
            { type: "created", objectType: `${normalized}::memory::ProjectMemory`, objectId: "0xproject" },
            { type: "created", objectType: `${normalized}::memory::OwnerCap`, objectId: "0xcap" },
          ],
        };
      },
    } as never,
    transactionBytes: bytes,
    transactionDigest: digest,
    typePackageId: PACKAGE,
  });
  assert.equal(requested, digest);
  assert.deepEqual(result, { digest, projectObjectId: "0xproject", ownerCapId: "0xcap" });
});

test("reconciliation returns null when the deterministic transaction is not on Sui", async () => {
  const value = await envelope();
  const result = await reconcileSponsoredRegistration({
    client: { async getTransactionBlock() { throw new Error("not found"); } } as never,
    transactionBytes: fromBase64(value.transactionBytes),
    typePackageId: PACKAGE,
  });
  assert.equal(result, null);
});
