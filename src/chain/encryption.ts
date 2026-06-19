import { BatonError } from "../core/errors.ts";
import { hashBytes } from "../core/hash.ts";
import { parseUploadJob, type UploadBlob, type UploadJob } from "../schema/remote.ts";

export interface EncryptionRequest {
  packageId: string;
  identity: string;
  threshold: number;
  data: Uint8Array;
  aad: Uint8Array;
}

/** SDK-neutral boundary: Seal is one implementation, tests can use a fake. */
export interface PayloadEncryptor {
  encrypt(request: EncryptionRequest): Promise<Uint8Array>;
}

export interface EncryptionPolicy {
  packageId: string;
  projectObjectId: string;
  threshold: number;
}

export function validateEncryptionPolicy(policy: EncryptionPolicy): EncryptionPolicy {
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

/** Seal identities bind the ciphertext to both its project and content hash. */
export function sealIdentity(projectObjectId: string, blob: UploadBlob): string {
  const project = projectObjectId.slice(2).toLowerCase().padStart(64, "0");
  return `0x${project}${blob.contentHash}`;
}

/** Additional authenticated data prevents a valid ciphertext being swapped between queue slots. */
export function sealAad(projectObjectId: string, handoffId: string, blob: UploadBlob): Uint8Array {
  return new TextEncoder().encode(
    ["baton", "v1", projectObjectId.toLowerCase(), handoffId, blob.kind, blob.id, blob.contentHash].join(":"),
  );
}

export function beginEncryptionAttempt(job: UploadJob, now: Date = new Date()): UploadJob {
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

export function markBlobEncrypted(
  job: UploadJob,
  blobId: string,
  encryptedBytes: Uint8Array,
  now: Date = new Date(),
): UploadJob {
  const target = job.blobs.find((blob) => blob.id === blobId);
  if (!target) throw new BatonError("NOT_FOUND", `upload job has no blob ${blobId}`);
  if (target.status === "uploaded") {
    throw new BatonError("INVALID_STATE", `blob ${blobId} is already uploaded`);
  }
  const encryptedHash = hashBytes(encryptedBytes);
  return parseUploadJob({
    ...job,
    status: "uploading",
    updatedAt: now.toISOString(),
    lastError: null,
    blobs: job.blobs.map((blob) =>
      blob.id === blobId
        ? { ...blob, status: "encrypted", encryptedHash, blobId: null }
        : blob,
    ),
  });
}

export function markPublicationFailed(job: UploadJob, error: unknown, now: Date = new Date()): UploadJob {
  const message = error instanceof Error ? error.message : String(error);
  return parseUploadJob({
    ...job,
    status: "failed",
    updatedAt: now.toISOString(),
    lastError: message || "unknown publication error",
  });
}

export async function encryptBlob(
  encryptor: PayloadEncryptor,
  policy: EncryptionPolicy,
  handoffId: string,
  blob: UploadBlob,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  validateEncryptionPolicy(policy);
  const actual = hashBytes(plaintext);
  if (actual !== blob.contentHash) {
    throw new BatonError(
      "HASH_MISMATCH",
      `refusing to encrypt blob ${blob.id}; plaintext hashes to ${actual}`,
    );
  }
  return encryptor.encrypt({
    packageId: policy.packageId,
    identity: sealIdentity(policy.projectObjectId, blob),
    threshold: policy.threshold,
    data: plaintext,
    aad: sealAad(policy.projectObjectId, handoffId, blob),
  });
}
