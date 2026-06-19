import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { normalizeSuiObjectId } from "@mysten/sui/utils";
import {
  buildSponsoredRegistrationBytes,
  serializeSponsoredTransaction,
  sponsoredTransactionDigest,
} from "../src/chain/sponsorship.ts";
import { reconcileSponsorState } from "../src/sponsor/reconcile.ts";
import {
  issueSponsorInvite,
  listSponsorInvites,
  markSponsorReservationSubmitted,
  saveSponsorReservation,
} from "../src/sponsor/state.ts";

const PACKAGE = normalizeSuiObjectId("0x1234");
let root: string;
let statePath: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-sponsor-reconcile-"));
  statePath = join(root, "sponsor.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("operator reconciliation completes a submitted reservation without the bearer token", async () => {
  const now = new Date("2026-06-19T12:00:00.000Z");
  const sponsor = new Ed25519Keypair();
  const user = new Ed25519Keypair();
  const token = issueSponsorInvite(statePath, now, 1);
  const bytes = await buildSponsoredRegistrationBytes({
    packageId: PACKAGE,
    projectId: "project-1",
    sender: user.toSuiAddress(),
    sponsor: sponsor.toSuiAddress(),
    gasPrice: 1000n,
    gasPayment: [{ objectId: "0x99", version: "1", digest: "2E3Wu14rQZ4rqfSi8Ve1arY4HWd1wv2cZmJbdatMgv2p" }],
    expirationEpoch: 1200n,
  });
  const digest = await sponsoredTransactionDigest(bytes);
  saveSponsorReservation(statePath, token, {
    requestId: "request-1",
    transactionBytes: serializeSponsoredTransaction(bytes),
    transactionDigest: digest,
    submittedAt: null,
    sponsor: sponsor.toSuiAddress(),
    gasPrice: "1000",
    gasBudget: "50000000",
    gasPayment: [{ objectId: "0x99", version: "1", digest: "2E3Wu14rQZ4rqfSi8Ve1arY4HWd1wv2cZmJbdatMgv2p" }],
    expirationEpoch: "1200",
    expiresAt: "2026-06-19T12:05:00.000Z",
    sender: user.toSuiAddress(),
    projectId: "project-1",
    result: null,
  }, now);
  markSponsorReservationSubmitted(statePath, token, "request-1", digest, now);

  const summary = await reconcileSponsorState({
    client: {
      async getTransactionBlock() {
        return {
          digest,
          effects: { status: { status: "success" } },
          objectChanges: [
            { type: "created", objectType: `${PACKAGE}::memory::ProjectMemory`, objectId: "0xproject" },
            { type: "created", objectType: `${PACKAGE}::memory::OwnerCap`, objectId: "0xcap" },
          ],
        };
      },
    } as never,
    statePath,
    typePackageId: PACKAGE,
    now: new Date("2026-06-20T12:00:00.000Z"),
  });
  assert.deepEqual(summary, { checked: 1, completed: 1, pending: 0 });
  const [invite] = listSponsorInvites(statePath, new Date("2026-06-20T12:00:00.000Z"));
  assert.equal(invite?.status, "used");
  assert.equal(invite?.digest, digest);
});

test("operator reconciliation is a no-op for an empty state", async () => {
  const summary = await reconcileSponsorState({
    client: {} as never,
    statePath,
    typePackageId: PACKAGE,
  });
  assert.deepEqual(summary, { checked: 0, completed: 0, pending: 0 });
});
