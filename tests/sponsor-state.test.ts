import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireSponsorStateLock,
  completeSponsorReservation,
  existingSponsorReservation,
  issueSponsorInvite,
  issueSponsorInviteDetails,
  listSponsorInvites,
  loadSponsorReservation,
  markSponsorReservationSubmitted,
  pruneSponsorInvites,
  revokeSponsorInvite,
  saveSponsorReservation,
  sponsorUsageSnapshot,
  type SponsorReservation,
  withSponsorStateLock,
} from "../src/sponsor/state.ts";

let root: string;
let path: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-sponsor-state-"));
  path = join(root, ".baton", "sponsor.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function reservation(): SponsorReservation {
  return {
    requestId: "request-1",
    transactionBytes: "bytes",
    transactionDigest: "HcmxyxYj9xEPxim7UWDesTWG1kB7hAP6eTxVMq2v39Z8",
    submittedAt: null,
    sponsor: "0x1",
    gasPrice: "1000",
    gasBudget: "50000000",
    gasPayment: [{ objectId: "0x99", version: "1", digest: "2E3Wu14rQZ4rqfSi8Ve1arY4HWd1wv2cZmJbdatMgv2p" }],
    expirationEpoch: "1200",
    expiresAt: "2026-06-19T12:10:00.000Z",
    sender: "0x2",
    projectId: "project-1",
    result: null,
  };
}

test("sponsor invitation tokens are stored hashed with restrictive permissions", () => {
  const token = issueSponsorInvite(path, new Date("2026-06-19T12:00:00.000Z"));
  assert.equal(token.length, 43);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(path, "utf8"), new RegExp(token));
});

test("the file-backed sponsor state permits only one daemon writer", () => {
  const release = acquireSponsorStateLock(path);
  try {
    assert.throws(() => acquireSponsorStateLock(path), /already in use by process/);
  } finally {
    release();
  }
  const releaseAgain = acquireSponsorStateLock(path);
  releaseAgain();
});

test("cross-process state operations serialize instead of losing updates", async () => {
  const order: string[] = [];
  await Promise.all([
    withSponsorStateLock(path, async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push("first-end");
    }),
    withSponsorStateLock(path, () => { order.push("second"); }),
  ]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("reservation is idempotent for one sender and project", () => {
  const now = new Date("2026-06-19T12:00:00.000Z");
  const token = issueSponsorInvite(path, now);
  saveSponsorReservation(path, token, reservation(), now);
  assert.deepEqual(existingSponsorReservation({ path, token, sender: "0x2", projectId: "project-1", now }), reservation());
  assert.throws(
    () => existingSponsorReservation({ path, token, sender: "0x3", projectId: "project-1", now }),
    /reserved for another/,
  );
});

test("completed invitations return their durable result and cannot be reused", () => {
  const now = new Date("2026-06-19T12:00:00.000Z");
  const token = issueSponsorInvite(path, now);
  saveSponsorReservation(path, token, reservation(), now);
  completeSponsorReservation(path, token, "request-1", {
    digest: "digest",
    projectObjectId: "0xproject",
    ownerCapId: "0xcap",
  }, now);
  assert.equal(loadSponsorReservation(path, token, "request-1", now).result?.digest, "digest");
  assert.throws(() => saveSponsorReservation(path, token, reservation(), now), /already been used/);
});

test("bound invitations reject recipient and project substitution before reservation", () => {
  const now = new Date("2026-06-19T12:00:00.000Z");
  const issued = issueSponsorInviteDetails(path, now, 1, { recipient: "0x2", projectId: "project-1" });
  assert.throws(
    () => existingSponsorReservation({ path, token: issued.token, sender: "0x3", projectId: "project-1", now }),
    /bound to another recipient/,
  );
  assert.throws(
    () => existingSponsorReservation({ path, token: issued.token, sender: "0x2", projectId: "project-2", now }),
    /bound to another project/,
  );
  assert.equal(existingSponsorReservation({ path, token: issued.token, sender: "0x2", projectId: "project-1", now }), null);
  const [summary] = listSponsorInvites(path, now);
  assert.equal(summary?.id, issued.id);
  assert.equal(summary?.recipient, "0x0000000000000000000000000000000000000000000000000000000000000002");
  assert.equal(summary?.projectId, "project-1");
  assert.equal(summary?.status, "available");
});

test("operators can revoke and prune unused invitations without deleting audit results", () => {
  const now = new Date("2026-06-19T12:00:00.000Z");
  const revoked = issueSponsorInviteDetails(path, now, 1);
  const used = issueSponsorInviteDetails(path, now, 1);
  saveSponsorReservation(path, used.token, reservation(), now);
  completeSponsorReservation(path, used.token, "request-1", {
    digest: "digest",
    projectObjectId: "0xproject",
    ownerCapId: "0xcap",
  }, now);
  revokeSponsorInvite(path, revoked.id, now);
  assert.throws(() => existingSponsorReservation({ path, token: revoked.token, sender: "0x2", projectId: "project-1", now }), /revoked/);
  assert.equal(listSponsorInvites(path, now).find((invite) => invite.id === revoked.id)?.status, "revoked");
  assert.equal(pruneSponsorInvites(path, now), 1);
  assert.deepEqual(listSponsorInvites(path, now).map((invite) => invite.status), ["used"]);
  assert.throws(() => revokeSponsorInvite(path, used.id, now), /used sponsor invitation cannot be revoked/);
});

test("usage snapshots bound daily liability and count only live reservations", () => {
  const now = new Date("2026-06-19T12:00:00.000Z");
  const completed = issueSponsorInviteDetails(path, now, 1);
  saveSponsorReservation(path, completed.token, reservation(), now);
  completeSponsorReservation(path, completed.token, "request-1", {
    digest: "digest",
    projectObjectId: "0xproject",
    ownerCapId: "0xcap",
  }, now);
  const active = issueSponsorInviteDetails(path, now, 1);
  saveSponsorReservation(path, active.token, { ...reservation(), requestId: "request-2" }, now);
  assert.deepEqual(sponsorUsageSnapshot(path, now), { completedToday: 1, activeReservations: 1 });
  assert.deepEqual(
    sponsorUsageSnapshot(path, new Date("2026-06-20T12:11:00.000Z")),
    { completedToday: 0, activeReservations: 0 },
  );
});

test("submitted reservations survive expiry and cannot be revoked or pruned before reconciliation", () => {
  const now = new Date("2026-06-19T12:00:00.000Z");
  const token = issueSponsorInviteDetails(path, now, 1);
  saveSponsorReservation(path, token.token, reservation(), now);
  const submitted = markSponsorReservationSubmitted(
    path,
    token.token,
    "request-1",
    "HcmxyxYj9xEPxim7UWDesTWG1kB7hAP6eTxVMq2v39Z8",
    now,
  );
  assert.equal(submitted.submittedAt, now.toISOString());
  const afterExpiry = new Date("2026-06-20T12:00:00.000Z");
  assert.equal(loadSponsorReservation(path, token.token, "request-1", afterExpiry).submittedAt, now.toISOString());
  assert.equal(listSponsorInvites(path, afterExpiry)[0]?.status, "submitted");
  assert.throws(() => revokeSponsorInvite(path, token.id, afterExpiry), /must be reconciled/);
  assert.equal(pruneSponsorInvites(path, afterExpiry), 0);
  assert.deepEqual(sponsorUsageSnapshot(path, afterExpiry), { completedToday: 0, activeReservations: 1 });
});
