import { shortId } from "../core/hash.ts";
import type { UploadJob, UploadStatus } from "../schema/remote.ts";

const STATUS_ORDER: UploadStatus[] = ["pending", "uploading", "anchoring", "failed", "complete"];

export function renderQueueStatus(jobs: UploadJob[]): string {
  if (jobs.length === 0) return "No batons queued for remote publication.\n";

  const counts = new Map<UploadStatus, number>();
  for (const job of jobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  const summary = STATUS_ORDER.filter((status) => counts.has(status))
    .map((status) => `${counts.get(status)} ${status}`)
    .join(" · ");

  const rows = jobs.map((job) => {
    const uploaded = job.blobs.filter((blob) => blob.status === "uploaded").length;
    const attempts = job.attempts === 1 ? "1 attempt" : `${job.attempts} attempts`;
    const error = job.lastError ? ` · ${job.lastError}` : "";
    return `${shortId(job.handoffId)}  ${job.status.padEnd(9)}  ${uploaded}/${job.blobs.length} blobs · ${attempts}${error}`;
  });

  return [`Remote publication queue: ${summary}`, "", ...rows, ""].join("\n");
}
