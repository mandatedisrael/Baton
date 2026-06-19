/**
 * Phase 3 local network state.
 *
 * These documents deliberately live outside the content-addressed handoff:
 * Walrus blob ids and Sui transaction data only exist after a baton is sealed,
 * so putting them inside the baton would change its identity.
 */
import { arr, isoDatetime, literal, nullable, num, obj, oneOf, str, ValidationError } from "./validate.ts";

export const UPLOAD_STATUSES = ["pending", "uploading", "anchoring", "complete", "failed"] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const BLOB_UPLOAD_STATUSES = ["pending", "encrypted", "uploaded"] as const;
export type BlobUploadStatus = (typeof BLOB_UPLOAD_STATUSES)[number];

export const UPLOAD_BLOB_KINDS = ["handoff", "attachment"] as const;
export type UploadBlobKind = (typeof UPLOAD_BLOB_KINDS)[number];

export interface UploadBlob {
  id: string;
  kind: UploadBlobKind;
  contentHash: string;
  status: BlobUploadStatus;
  /** Hash of the encrypted bytes, populated after Seal encryption. */
  encryptedHash: string | null;
  /** Walrus blob id, populated after upload. */
  blobId: string | null;
}

export interface UploadAnchor {
  status: "pending" | "anchored";
  txDigest: string | null;
}

export interface UploadJob {
  schemaVersion: 1;
  handoffId: string;
  status: UploadStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  blobs: UploadBlob[];
  anchor: UploadAnchor;
}

export interface RemoteAttachmentRef {
  id: string;
  contentHash: string;
  blobId: string;
}

export interface RemoteAnchor {
  network: string;
  projectObjectId: string;
  txDigest: string;
  anchoredAt: string;
}

/** Completed remote publication metadata, cached locally after anchoring. */
export interface RemoteSidecar {
  schemaVersion: 1;
  handoffId: string;
  handoffBlobId: string;
  attachments: RemoteAttachmentRef[];
  anchor: RemoteAnchor;
}

function hash(v: unknown, path: string): string {
  const value = str(v, path);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ValidationError(path, "expected 64 lowercase hex characters");
  }
  return value;
}

function parseUploadBlob(v: unknown, path: string): UploadBlob {
  const r = obj(v, path, ["id", "kind", "contentHash", "status", "encryptedHash", "blobId"]);
  const blob: UploadBlob = {
    id: str(r.id, `${path}.id`, { min: 1 }),
    kind: oneOf(r.kind, `${path}.kind`, UPLOAD_BLOB_KINDS),
    contentHash: hash(r.contentHash, `${path}.contentHash`),
    status: oneOf(r.status, `${path}.status`, BLOB_UPLOAD_STATUSES),
    encryptedHash: nullable(r.encryptedHash, `${path}.encryptedHash`, hash),
    blobId: nullable(r.blobId, `${path}.blobId`, (value, p) => str(value, p, { min: 1 })),
  };
  if (blob.status === "pending" && (blob.encryptedHash !== null || blob.blobId !== null)) {
    throw new ValidationError(path, "pending blob cannot have encrypted or remote metadata");
  }
  if (blob.status === "encrypted" && (blob.encryptedHash === null || blob.blobId !== null)) {
    throw new ValidationError(path, "encrypted blob requires encryptedHash and no blobId");
  }
  if (blob.status === "uploaded" && (blob.encryptedHash === null || blob.blobId === null)) {
    throw new ValidationError(path, "uploaded blob requires encryptedHash and blobId");
  }
  return blob;
}

function parseUploadAnchor(v: unknown, path: string): UploadAnchor {
  const r = obj(v, path, ["status", "txDigest"]);
  const anchor: UploadAnchor = {
    status: oneOf(r.status, `${path}.status`, ["pending", "anchored"] as const),
    txDigest: nullable(r.txDigest, `${path}.txDigest`, (value, p) => str(value, p, { min: 1 })),
  };
  if (anchor.status === "pending" && anchor.txDigest !== null) {
    throw new ValidationError(path, "pending anchor cannot have a transaction digest");
  }
  if (anchor.status === "anchored" && anchor.txDigest === null) {
    throw new ValidationError(path, "anchored state requires a transaction digest");
  }
  return anchor;
}

export function parseUploadJob(v: unknown): UploadJob {
  const r = obj(v, "uploadJob", [
    "schemaVersion",
    "handoffId",
    "status",
    "attempts",
    "createdAt",
    "updatedAt",
    "lastError",
    "blobs",
    "anchor",
  ]);
  const job: UploadJob = {
    schemaVersion: literal(r.schemaVersion, "uploadJob.schemaVersion", 1),
    handoffId: hash(r.handoffId, "uploadJob.handoffId"),
    status: oneOf(r.status, "uploadJob.status", UPLOAD_STATUSES),
    attempts: num(r.attempts, "uploadJob.attempts", { int: true, min: 0 }),
    createdAt: isoDatetime(r.createdAt, "uploadJob.createdAt"),
    updatedAt: isoDatetime(r.updatedAt, "uploadJob.updatedAt"),
    lastError: nullable(r.lastError, "uploadJob.lastError", (value, p) => str(value, p, { min: 1 })),
    blobs: arr(r.blobs, "uploadJob.blobs", parseUploadBlob),
    anchor: parseUploadAnchor(r.anchor, "uploadJob.anchor"),
  };
  if (job.blobs.filter((blob) => blob.kind === "handoff").length !== 1) {
    throw new ValidationError("uploadJob.blobs", "expected exactly one handoff blob");
  }
  const handoffBlob = job.blobs.find((blob) => blob.kind === "handoff")!;
  if (handoffBlob.id !== "handoff" || handoffBlob.contentHash !== job.handoffId) {
    throw new ValidationError("uploadJob.blobs", "handoff blob must use id 'handoff' and the baton content hash");
  }
  if (new Set(job.blobs.map((blob) => blob.id)).size !== job.blobs.length) {
    throw new ValidationError("uploadJob.blobs", "blob ids must be unique");
  }
  const allUploaded = job.blobs.every((blob) => blob.status === "uploaded");
  if ((job.status === "anchoring" || job.status === "complete") && !allUploaded) {
    throw new ValidationError("uploadJob.status", `${job.status} requires every blob to be uploaded`);
  }
  if (job.status === "complete" && job.anchor.status !== "anchored") {
    throw new ValidationError("uploadJob.status", "complete requires an anchored transaction");
  }
  return job;
}

function parseRemoteAttachment(v: unknown, path: string): RemoteAttachmentRef {
  const r = obj(v, path, ["id", "contentHash", "blobId"]);
  return {
    id: str(r.id, `${path}.id`, { min: 1 }),
    contentHash: hash(r.contentHash, `${path}.contentHash`),
    blobId: str(r.blobId, `${path}.blobId`, { min: 1 }),
  };
}

function parseRemoteAnchor(v: unknown, path: string): RemoteAnchor {
  const r = obj(v, path, ["network", "projectObjectId", "txDigest", "anchoredAt"]);
  return {
    network: str(r.network, `${path}.network`, { min: 1 }),
    projectObjectId: str(r.projectObjectId, `${path}.projectObjectId`, { min: 1 }),
    txDigest: str(r.txDigest, `${path}.txDigest`, { min: 1 }),
    anchoredAt: isoDatetime(r.anchoredAt, `${path}.anchoredAt`),
  };
}

export function parseRemoteSidecar(v: unknown): RemoteSidecar {
  const r = obj(v, "remoteSidecar", [
    "schemaVersion",
    "handoffId",
    "handoffBlobId",
    "attachments",
    "anchor",
  ]);
  const sidecar: RemoteSidecar = {
    schemaVersion: literal(r.schemaVersion, "remoteSidecar.schemaVersion", 1),
    handoffId: hash(r.handoffId, "remoteSidecar.handoffId"),
    handoffBlobId: str(r.handoffBlobId, "remoteSidecar.handoffBlobId", { min: 1 }),
    attachments: arr(r.attachments, "remoteSidecar.attachments", parseRemoteAttachment),
    anchor: parseRemoteAnchor(r.anchor, "remoteSidecar.anchor"),
  };
  if (new Set(sidecar.attachments.map((attachment) => attachment.id)).size !== sidecar.attachments.length) {
    throw new ValidationError("remoteSidecar.attachments", "attachment ids must be unique");
  }
  return sidecar;
}
