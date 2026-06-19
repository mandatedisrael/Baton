import { BatonError } from "../core/errors.js";
import { hashCanonical } from "../core/hash.js";
import { parseUploadJob } from "../schema/remote.js";
/** Build the first durable queue snapshot for a locally sealed baton. */
export function createUploadJob(handoffId, handoff, now = new Date()) {
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
                kind: "attachment",
                contentHash: attachment.contentHash,
                status: "pending",
                encryptedHash: null,
                blobId: null,
                walrus: null,
            })),
        ],
        anchor: { status: "pending", txDigest: null },
    });
}
//# sourceMappingURL=queue.js.map