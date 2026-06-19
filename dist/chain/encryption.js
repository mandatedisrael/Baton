import { BatonError } from "../core/errors.js";
import { hashBytes } from "../core/hash.js";
import { parseUploadJob } from "../schema/remote.js";
export function validateEncryptionPolicy(policy) {
    if (!/^0x[a-fA-F0-9]+$/.test(policy.packageId)) {
        throw new BatonError("INVALID_STATE", "Seal package id must be a 0x-prefixed hex value");
    }
    if (!/^0x[a-fA-F0-9]{1,64}$/.test(policy.projectObjectId)) {
        throw new BatonError("INVALID_STATE", "project object id must be a 0x-prefixed Sui address");
    }
    if (!Number.isInteger(policy.threshold) || policy.threshold < 1) {
        throw new BatonError("INVALID_STATE", "Seal threshold must be a positive integer");
    }
    return policy;
}
/** Seal identities bind every payload to its project and anchored baton. */
export function sealIdentity(projectObjectId, handoffId) {
    const project = projectObjectId.slice(2).toLowerCase().padStart(64, "0");
    if (!/^[a-f0-9]{64}$/.test(handoffId)) {
        throw new BatonError("INVALID_HANDOFF", "Seal baton identity must be 64 lowercase hex characters");
    }
    return `0x${project}${handoffId}`;
}
/** Additional authenticated data prevents a valid ciphertext being swapped between queue slots. */
export function sealAad(projectObjectId, handoffId, blob) {
    return new TextEncoder().encode(["baton", "v1", projectObjectId.toLowerCase(), handoffId, blob.kind, blob.id, blob.contentHash].join(":"));
}
export function beginEncryptionAttempt(job, now = new Date()) {
    if (job.status === "complete" || job.status === "anchoring") {
        throw new BatonError("INVALID_STATE", `cannot encrypt a ${job.status} publication job`);
    }
    return parseUploadJob({
        ...job,
        status: "uploading",
        attempts: job.attempts + 1,
        updatedAt: now.toISOString(),
        lastError: null,
    });
}
export function markBlobEncrypted(job, blobId, encryptedBytes, now = new Date()) {
    const target = job.blobs.find((blob) => blob.id === blobId);
    if (!target)
        throw new BatonError("NOT_FOUND", `upload job has no blob ${blobId}`);
    if (target.status === "uploaded") {
        throw new BatonError("INVALID_STATE", `blob ${blobId} is already uploaded`);
    }
    const encryptedHash = hashBytes(encryptedBytes);
    return parseUploadJob({
        ...job,
        status: "uploading",
        updatedAt: now.toISOString(),
        lastError: null,
        blobs: job.blobs.map((blob) => blob.id === blobId
            ? { ...blob, status: "encrypted", encryptedHash, blobId: null }
            : blob),
    });
}
export function markPublicationFailed(job, error, now = new Date()) {
    const message = error instanceof Error ? error.message : String(error);
    return parseUploadJob({
        ...job,
        status: "failed",
        updatedAt: now.toISOString(),
        lastError: message || "unknown publication error",
    });
}
export async function encryptBlob(encryptor, policy, handoffId, blob, plaintext) {
    validateEncryptionPolicy(policy);
    const actual = hashBytes(plaintext);
    if (actual !== blob.contentHash) {
        throw new BatonError("HASH_MISMATCH", `refusing to encrypt blob ${blob.id}; plaintext hashes to ${actual}`);
    }
    return encryptor.encrypt({
        packageId: policy.packageId,
        identity: sealIdentity(policy.projectObjectId, handoffId),
        threshold: policy.threshold,
        data: plaintext,
        aad: sealAad(policy.projectObjectId, handoffId, blob),
    });
}
//# sourceMappingURL=encryption.js.map