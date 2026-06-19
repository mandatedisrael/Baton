import { canonicalize } from "../core/canonical.js";
import { BatonError } from "../core/errors.js";
import { hashBytes } from "../core/hash.js";
import { ProjectStore } from "../store/project.js";
import { beginEncryptionAttempt, encryptBlob, markBlobEncrypted, markPublicationFailed, } from "./encryption.js";
/** Load and verify the canonical plaintext represented by one queue blob. */
export function loadPlaintextPayload(store, job, blob) {
    let data;
    if (blob.kind === "handoff") {
        data = Buffer.from(canonicalize(store.loadHandoff(job.handoffId)), "utf8");
    }
    else {
        const handoff = store.loadHandoff(job.handoffId);
        const attachment = handoff.attachments.find((item) => item.id === blob.id);
        if (!attachment) {
            throw new BatonError("INVALID_HANDOFF", `baton ${job.handoffId} has no attachment ${blob.id}`);
        }
        if (attachment.contentHash !== blob.contentHash) {
            throw new BatonError("HASH_MISMATCH", `queue metadata for attachment ${blob.id} does not match the baton`);
        }
        data = store.loadAttachment(attachment);
    }
    const actual = hashBytes(data);
    if (actual !== blob.contentHash) {
        throw new BatonError("HASH_MISMATCH", `plaintext payload ${blob.id} hashes to ${actual}`);
    }
    return data;
}
/**
 * Encrypt every pending payload, checkpointing after each blob. Failures are
 * recorded in the queue document and returned rather than losing progress.
 */
export async function encryptQueuedJob(store, handoffId, encryptor, policy, now = new Date()) {
    let job = store.loadUploadJob(handoffId);
    if (!job.blobs.some((blob) => blob.status === "pending"))
        return job;
    job = beginEncryptionAttempt(job, now);
    store.saveUploadJob(job);
    try {
        for (const blob of job.blobs) {
            if (blob.status !== "pending") {
                if (blob.status === "encrypted")
                    store.loadEncryptedPayload(job, blob.id);
                continue;
            }
            const plaintext = loadPlaintextPayload(store, job, blob);
            const encrypted = await encryptBlob(encryptor, policy, job.handoffId, blob, plaintext);
            job = markBlobEncrypted(job, blob.id, encrypted, now);
            store.saveEncryptedPayload(job, blob.id, encrypted);
            store.saveUploadJob(job);
        }
        return job;
    }
    catch (err) {
        job = markPublicationFailed(job, err, now);
        store.saveUploadJob(job);
        return job;
    }
}
//# sourceMappingURL=payloads.js.map