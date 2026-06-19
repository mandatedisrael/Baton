import { BatonError } from "../core/errors.ts";
import { hashCanonical } from "../core/hash.ts";
import { CAPTURE_MODES, parseHandoff, TOOL_IDS, type Handoff } from "../schema/handoff.ts";
import type { RemoteProjectConfig } from "../schema/project.ts";
import { ProjectStore } from "../store/project.ts";
import { decryptBlob, type PayloadDecryptor, type RemoteBlobDescriptor } from "./decryption.ts";
import type { VerifiedRemoteManifest } from "./manifest.ts";
import { fetchVerifiedCiphertext, type WalrusRetriever } from "./retrieval.ts";

function rubricVersion(value: string | undefined): number {
  if (value === undefined) return 0;
  const match = /^v(\d+)$/.exec(value);
  return match ? Number(match[1]) : -1;
}

function assertManifestMatchesHandoff(manifest: VerifiedRemoteManifest, handoff: Handoff): void {
  const fidelityBps = handoff.fidelity.score === null ? null : Math.round(handoff.fidelity.score * 10_000);
  const timestampMs = BigInt(Date.parse(handoff.meta.timestamp));
  const metadataMatches =
    manifest.branch === (handoff.meta.branch ?? "main") &&
    manifest.parents.length === handoff.meta.parents.length &&
    manifest.parents.every((parent, index) => parent === handoff.meta.parents[index]) &&
    manifest.fidelityBps === fidelityBps &&
    manifest.graderModel === (handoff.fidelity.graderModel ?? "") &&
    manifest.rubricVersion === rubricVersion(handoff.fidelity.rubricVersion) &&
    manifest.captureMode === CAPTURE_MODES.indexOf(handoff.meta.captureMode) &&
    manifest.tool === TOOL_IDS.indexOf(handoff.meta.tool) &&
    manifest.timestampMs === timestampMs;
  if (!metadataMatches) {
    throw new BatonError("HASH_MISMATCH", "decrypted handoff metadata does not match its on-chain manifest");
  }
  if (manifest.attachments.length !== handoff.attachments.length) {
    throw new BatonError("HASH_MISMATCH", "decrypted handoff attachment count does not match its manifest");
  }
  for (let index = 0; index < manifest.attachments.length; index += 1) {
    const remote = manifest.attachments[index]!;
    const local = handoff.attachments[index]!;
    if (remote.id !== local.id || remote.contentHash !== local.contentHash) {
      throw new BatonError("HASH_MISMATCH", `attachment ${index} does not match its on-chain manifest`);
    }
  }
}

function knownEncryptedHash(
  store: ProjectStore,
  handoffId: string,
  descriptor: RemoteBlobDescriptor,
): string | undefined {
  try {
    const job = store.loadUploadJob(handoffId);
    const queued = job.blobs.find((blob) => blob.id === descriptor.id);
    if (!queued) return undefined;
    if (queued.contentHash !== descriptor.contentHash || queued.blobId !== descriptor.blobId) {
      throw new BatonError("HASH_MISMATCH", `local publication receipt disagrees with remote blob ${descriptor.id}`);
    }
    return queued.encryptedHash ?? undefined;
  } catch (err) {
    if (err instanceof BatonError && err.code === "NOT_FOUND") return undefined;
    throw err;
  }
}

async function recoverBlob(input: {
  store: ProjectStore;
  manifest: VerifiedRemoteManifest;
  remote: RemoteProjectConfig;
  retriever: WalrusRetriever;
  decryptor: PayloadDecryptor;
  descriptor: RemoteBlobDescriptor;
}): Promise<Uint8Array> {
  const ciphertext = await fetchVerifiedCiphertext({
    retriever: input.retriever,
    blobId: input.descriptor.blobId,
    encryptedHash: knownEncryptedHash(input.store, input.manifest.handoffId, input.descriptor),
  });
  return decryptBlob({
    decryptor: input.decryptor,
    packageId: input.remote.packageId,
    projectObjectId: input.remote.projectObjectId,
    authority: input.remote.authority,
    handoffId: input.manifest.handoffId,
    blob: input.descriptor,
    ciphertext,
  });
}

export async function recoverRemoteHandoff(input: {
  store: ProjectStore;
  manifest: VerifiedRemoteManifest;
  remote: RemoteProjectConfig;
  retriever: WalrusRetriever;
  decryptor: PayloadDecryptor;
}): Promise<Handoff> {
  const handoffBytes = await recoverBlob({ ...input, descriptor: input.manifest.handoff });
  let handoff: Handoff;
  try {
    handoff = parseHandoff(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(handoffBytes)));
  } catch (err) {
    throw new BatonError("INVALID_HANDOFF", "decrypted remote baton is not valid handoff JSON", { cause: err });
  }
  const actual = hashCanonical(handoff);
  if (actual !== input.manifest.handoffId) {
    throw new BatonError("HASH_MISMATCH", `decrypted handoff hashes to ${actual}, expected ${input.manifest.handoffId}`);
  }
  assertManifestMatchesHandoff(input.manifest, handoff);

  const recoveredAttachments: Array<{ index: number; bytes: Uint8Array }> = [];
  for (let index = 0; index < input.manifest.attachments.length; index += 1) {
    recoveredAttachments.push({
      index,
      bytes: await recoverBlob({ ...input, descriptor: input.manifest.attachments[index]! }),
    });
  }
  // Persist only after the complete remote set has been authenticated.
  for (const recovered of recoveredAttachments) {
    input.store.saveAttachment(handoff.attachments[recovered.index]!, recovered.bytes);
  }
  input.store.saveHandoff(handoff, input.manifest.handoffId);
  return handoff;
}
