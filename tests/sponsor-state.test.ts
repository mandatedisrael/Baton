import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  completeSponsorReservation,
  existingSponsorReservation,
  issueSponsorInvite,
  loadSponsorReservation,
  saveSponsorReservation,
  type SponsorReservation,
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
    sponsor: "0x1",
    gasPrice: "1000",
    gasBudget: "50000000",
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
