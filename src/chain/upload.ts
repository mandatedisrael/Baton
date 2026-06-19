import { BatonError } from "../core/errors.ts";
import { parseUploadJob, type UploadJob, type WalrusResumeStep } from "../schema/remote.ts";
import { ProjectStore } from "../store/project.ts";
import { markPublicationFailed } from "./encryption.ts";
import type { WalrusUploader } from "./walrus.ts";

const STEP_ORDER: WalrusResumeStep["step"][] = ["encoded", "registered", "uploaded"];

export function beginUploadAttempt(job: UploadJob, now: Date = new Date()): UploadJob {
  if (job.status === "complete" || job.status === "anchoring") {
    throw new BatonError("INVALID_STATE", `cannot upload a ${job.status} publication job`);
  }
  if (job.blobs.some((blob) => blob.status === "pending")) {
    throw new BatonError("INVALID_STATE", "all payloads must be encrypted before Walrus upload");
  }
  return parseUploadJob({
    ...job,
    status: "uploading",
    attempts: job.attempts + 1,
    updatedAt: now.toISOString(),
    lastError: null,
  });
}

export function markWalrusCheckpoint(
  job: UploadJob,
  queueBlobId: string,
  checkpoint: WalrusResumeStep,
  now: Date = new Date(),
): UploadJob {
  const target = job.blobs.find((blob) => blob.id === queueBlobId);
  if (!target) throw new BatonError("NOT_FOUND", `upload job has no blob ${queueBlobId}`);
  if (target.status !== "encrypted") {
    throw new BatonError("INVALID_STATE", `blob ${queueBlobId} is not awaiting Walrus upload`);
  }
  if (target.walrus) {
    if (target.walrus.blobId !== checkpoint.blobId) {
      throw new BatonError("HASH_MISMATCH", `Walrus blob identity changed while uploading ${queueBlobId}`);
    }
    if (STEP_ORDER.indexOf(checkpoint.step) < STEP_ORDER.indexOf(target.walrus.step)) {
      throw new BatonError("INVALID_STATE", `Walrus checkpoint regressed for ${queueBlobId}`);
    }
  }
  return parseUploadJob({
    ...job,
    status: "uploading",
    updatedAt: now.toISOString(),
    lastError: null,
    blobs: job.blobs.map((blob) => blob.id === queueBlobId ? { ...blob, walrus: checkpoint } : blob),
  });
}

export function markBlobUploaded(
  job: UploadJob,
  queueBlobId: string,
  blobId: string,
  now: Date = new Date(),
): UploadJob {
  const target = job.blobs.find((blob) => blob.id === queueBlobId);
  if (!target) throw new BatonError("NOT_FOUND", `upload job has no blob ${queueBlobId}`);
  if (target.status !== "encrypted" || target.walrus?.step !== "uploaded") {
    throw new BatonError("INVALID_STATE", `blob ${queueBlobId} has not completed the Walrus upload step`);
  }
  if (target.walrus.blobId !== blobId) {
    throw new BatonError("HASH_MISMATCH", `certified Walrus blob id changed for ${queueBlobId}`);
  }
  const blobs = job.blobs.map((blob) =>
    blob.id === queueBlobId ? { ...blob, status: "uploaded" as const, blobId } : blob
  );
  return parseUploadJob({
    ...job,
    status: blobs.every((blob) => blob.status === "uploaded") ? "anchoring" : "uploading",
    updatedAt: now.toISOString(),
    lastError: null,
    blobs,
  });
}

/** Upload encrypted queue payloads one-by-one with an atomic save after every SDK checkpoint. */
export async function uploadQueuedJob(
  store: ProjectStore,
  handoffId: string,
  uploader: WalrusUploader,
  now: Date = new Date(),
): Promise<UploadJob> {
  let job = store.loadUploadJob(handoffId);
  if (job.blobs.every((blob) => blob.status === "uploaded")) return job;
  job = beginUploadAttempt(job, now);
  store.saveUploadJob(job);

  try {
    for (const candidate of job.blobs) {
      if (candidate.status === "uploaded") continue;
      if (candidate.status !== "encrypted") {
        throw new BatonError("INVALID_STATE", `blob ${candidate.id} must be encrypted before upload`);
      }
      const data = store.loadEncryptedPayload(job, candidate.id);
      const result = await uploader.upload({
        data,
        resume: candidate.walrus,
        onCheckpoint(checkpoint) {
          job = markWalrusCheckpoint(job, candidate.id, checkpoint, now);
          store.saveUploadJob(job);
        },
      });
      job = markBlobUploaded(job, candidate.id, result.blobId, now);
      store.saveUploadJob(job);
    }
    return job;
  } catch (err) {
    job = markPublicationFailed(job, err, now);
    store.saveUploadJob(job);
    return job;
  }
}
