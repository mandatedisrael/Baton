import { BatonError } from "../core/errors.ts";
import { hashCanonical } from "../core/hash.ts";
import type { Handoff } from "../schema/handoff.ts";
import { parseUploadJob, type UploadJob } from "../schema/remote.ts";

/** Build the first durable queue snapshot for a locally sealed baton. */
export function createUploadJob(handoffId: string, handoff: Handoff, now: Date = new Date()): UploadJob {
  const actual = hashCanonical(handoff);
  if (actual !== handoffId) {
    throw new BatonError("HASH_MISMATCH", `cannot queue baton ${handoffId}; content hashes to ${actual}`);
  }
  const timestamp = now.toISOString();
  return parseUploadJob({
    schemaVersion: 1,
    handoffId,
    status: "pending",
    attempts: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastError: null,
    blobs: [
      {
        id: "handoff",
        kind: "handoff",
        contentHash: handoffId,
        status: "pending",
        encryptedHash: null,
        blobId: null,
        walrus: null,
      },
      ...handoff.attachments.map((attachment) => ({
        id: attachment.id,
        kind: "attachment" as const,
        contentHash: attachment.contentHash,
        status: "pending" as const,
        encryptedHash: null,
        blobId: null,
        walrus: null,
      })),
    ],
    anchor: { status: "pending", txDigest: null },
  });
}
