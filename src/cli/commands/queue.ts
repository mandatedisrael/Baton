import { renderQueueStatus } from "../../render/queue.ts";
import { ProjectStore } from "../../store/project.ts";
import { encryptQueuedJob } from "../../chain/payloads.ts";
import { createSealPayloadEncryptor } from "../../chain/seal.ts";
import { BatonError } from "../../core/errors.ts";
import { ok, warn } from "../output.ts";

export function runQueueStatus(cwd: string): void {
  const store = ProjectStore.open(cwd);
  process.stdout.write(renderQueueStatus(store.listUploadJobs()));
}

export async function runQueueEncrypt(cwd: string): Promise<void> {
  const store = ProjectStore.open(cwd);
  const remote = store.config().remote;
  if (!remote) {
    throw new BatonError("INVALID_STATE", "project is local-only — run `baton login` then `baton register`");
  }
  const encryptor = createSealPayloadEncryptor({
    network: remote.network,
    rpcUrl: remote.rpcUrl,
    serverConfigs: remote.seal.serverConfigs,
  });
  const pending = store.listUploadJobs().filter((job) =>
    job.blobs.some((blob) => blob.status === "pending"),
  );
  if (pending.length === 0) {
    ok("all queued payloads are already encrypted");
    return;
  }

  let failed = 0;
  for (const queued of pending) {
    const job = await encryptQueuedJob(
      store,
      queued.handoffId,
      encryptor,
      {
        packageId: remote.packageId,
        projectObjectId: remote.projectObjectId,
        threshold: remote.seal.threshold,
      },
    );
    if (job.status === "failed") {
      failed += 1;
      warn(`${queued.handoffId.slice(0, 12)} encryption failed: ${job.lastError}`);
    } else {
      ok(`${queued.handoffId.slice(0, 12)} encrypted and verified (${job.blobs.length} blob(s))`);
    }
  }
  if (failed > 0) {
    throw new BatonError("IO_ERROR", `${failed} publication job(s) could not be encrypted`);
  }
}
