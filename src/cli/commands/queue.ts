import { renderQueueStatus } from "../../render/queue.ts";
import { ProjectStore } from "../../store/project.ts";
import { encryptQueuedJob } from "../../chain/payloads.ts";
import { createSealPayloadEncryptor } from "../../chain/seal.ts";
import { BatonError } from "../../core/errors.ts";
import { loadIdentity, isZkLoginIdentity, requireEd25519Identity } from "../../chain/identity.ts";
import { loadEphemeralFromSession } from "../../chain/zklogin.ts";
import { createWalrusUploader } from "../../chain/walrus.ts";
import { uploadQueuedJob } from "../../chain/upload.ts";
import { anchorQueuedJob } from "../../chain/anchor.ts";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
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

export async function runQueueUpload(cwd: string, identityPath?: string): Promise<void> {
  const store = ProjectStore.open(cwd);
  const remote = store.config().remote;
  if (!remote) {
    throw new BatonError("INVALID_STATE", "project is local-only — run `baton login` then `baton register`");
  }
  const loaded = loadIdentity(identityPath);
  const keypair = isZkLoginIdentity(loaded)
    ? loadEphemeralFromSession(loaded.session)
    : requireEd25519Identity(loaded).keypair;
  const uploader = createWalrusUploader({ remote, keypair });
  const jobs = store.listUploadJobs();
  const unencrypted = jobs.filter((job) => job.blobs.some((blob) => blob.status === "pending"));
  if (unencrypted.length > 0) {
    throw new BatonError("INVALID_STATE", `${unencrypted.length} queued baton(s) still need \`baton queue encrypt\``);
  }
  const pending = jobs.filter((job) => job.blobs.some((blob) => blob.status === "encrypted"));
  if (pending.length === 0) {
    ok("all encrypted payloads are already certified on Walrus");
    return;
  }

  let failed = 0;
  for (const queued of pending) {
    const job = await uploadQueuedJob(store, queued.handoffId, uploader);
    if (job.status === "failed") {
      failed += 1;
      warn(`${queued.handoffId.slice(0, 12)} upload failed: ${job.lastError}`);
    } else {
      ok(`${queued.handoffId.slice(0, 12)} certified on Walrus (${job.blobs.length} blob(s))`);
    }
  }
  if (failed > 0) throw new BatonError("IO_ERROR", `${failed} publication job(s) could not be uploaded`);
}

export async function runQueueAnchor(cwd: string, identityPath?: string): Promise<void> {
  const store = ProjectStore.open(cwd);
  const remote = store.config().remote;
  if (!remote) {
    throw new BatonError("INVALID_STATE", "project is local-only — run `baton login` then `baton register`");
  }
  const loaded = loadIdentity(identityPath);
  const client = new SuiJsonRpcClient({ network: remote.network, url: remote.rpcUrl });
  const jobs = store.listUploadJobs();
  const notUploaded = jobs.filter((job) => job.blobs.some((blob) => blob.status !== "uploaded"));
  if (notUploaded.length > 0) {
    throw new BatonError("INVALID_STATE", `${notUploaded.length} queued baton(s) still need encryption or upload`);
  }
  const pending = jobs.filter((job) => job.anchor.status === "pending");
  if (pending.length === 0) {
    ok("all uploaded batons are already anchored on Sui");
    return;
  }

  let failed = 0;
  for (const queued of pending) {
    const result = await anchorQueuedJob({
      store,
      handoffId: queued.handoffId,
      client,
      identity: loaded,
      remote,
    });
    if (result.job.status === "failed" || !result.sidecar) {
      failed += 1;
      warn(`${queued.handoffId.slice(0, 12)} anchoring failed: ${result.job.lastError}`);
    } else {
      ok(`${queued.handoffId.slice(0, 12)} anchored and verified: ${result.sidecar.anchor.txDigest}`);
    }
  }
  if (failed > 0) throw new BatonError("IO_ERROR", `${failed} publication job(s) could not be anchored`);
}
