import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { fetchRemoteManifest } from "../chain/manifest.ts";
import { recoverRemoteHandoff, verifyRemoteHandoff } from "../chain/recovery.ts";
import { createWalrusRetriever } from "../chain/retrieval.ts";
import { loadIdentity, getIdentityAddress, requireEd25519Identity } from "../chain/identity.ts";
import { createSealPayloadDecryptor } from "../chain/seal.ts";
import { BatonError } from "../core/errors.ts";
import type { Handoff } from "../schema/handoff.ts";
import { ProjectStore } from "../store/project.ts";

export type HandoffRecoverer = (id: string) => Promise<Handoff>;

export interface RemoteAuditReport {
  handoffId: string;
  anchorTx: string;
  handoffBlobId: string;
  attachments: Array<{ id: string; blobId: string; bytes: number }>;
  totalPlaintextBytes: number;
}

export async function ensureHandoffAvailable(
  store: ProjectStore,
  id: string,
  recoverer: HandoffRecoverer,
): Promise<Handoff> {
  try {
    const handoff = store.loadHandoff(id);
    for (const attachment of handoff.attachments) {
      try {
        store.loadAttachment(attachment);
      } catch (err) {
        if (err instanceof BatonError && err.code === "NOT_FOUND") return recoverer(id);
        throw err;
      }
    }
    return handoff;
  } catch (err) {
    if (!(err instanceof BatonError) || err.code !== "NOT_FOUND") throw err;
  }
  return recoverer(id);
}

export async function recoverHandoffFromRemote(
  store: ProjectStore,
  handoffId: string,
  identityPath?: string,
): Promise<Handoff> {
  if (!/^[a-f0-9]{64}$/.test(handoffId)) {
    throw new BatonError("INVALID_HANDOFF", "remote recovery requires a full 64-character baton id");
  }
  const remote = store.config().remote;
  if (!remote) {
    throw new BatonError("INVALID_STATE", "project is local-only — register it before remote recovery");
  }
  const loaded = loadIdentity(identityPath);
  const client = new SuiJsonRpcClient({ network: remote.network, url: remote.rpcUrl });
  const manifest = await fetchRemoteManifest({ client, remote, handoffId });
  const retriever = createWalrusRetriever({ aggregatorUrl: remote.walrus.aggregatorUrl });
  const { keypair } = requireEd25519Identity(loaded); // Seal decryption currently requires ED key material
  const decryptor = createSealPayloadDecryptor({
    network: remote.network,
    rpcUrl: remote.rpcUrl,
    serverConfigs: remote.seal.serverConfigs,
    keypair,
  });
  return recoverRemoteHandoff({ store, manifest, remote, retriever, decryptor });
}

export async function auditHandoffFromRemote(
  store: ProjectStore,
  handoffId: string,
  identityPath?: string,
): Promise<RemoteAuditReport> {
  if (!/^[a-f0-9]{64}$/.test(handoffId)) {
    throw new BatonError("INVALID_HANDOFF", "remote audit requires a full 64-character baton id");
  }
  const remote = store.config().remote;
  if (!remote) throw new BatonError("INVALID_STATE", "project is local-only — register it before remote audit");
  const loaded = loadIdentity(identityPath);
  const client = new SuiJsonRpcClient({ network: remote.network, url: remote.rpcUrl });
  const manifest = await fetchRemoteManifest({ client, remote, handoffId });
  const retriever = createWalrusRetriever({ aggregatorUrl: remote.walrus.aggregatorUrl });
  const { keypair } = requireEd25519Identity(loaded); // Seal decryption currently requires ED key material
  const decryptor = createSealPayloadDecryptor({
    network: remote.network,
    rpcUrl: remote.rpcUrl,
    serverConfigs: remote.seal.serverConfigs,
    keypair,
  });
  const verified = await verifyRemoteHandoff({ store, manifest, remote, retriever, decryptor });
  const attachments = verified.attachments.map((attachment) => ({
    id: manifest.attachments[attachment.index]!.id,
    blobId: manifest.attachments[attachment.index]!.blobId,
    bytes: attachment.bytes.byteLength,
  }));
  return {
    handoffId,
    anchorTx: manifest.anchorTx,
    handoffBlobId: manifest.handoff.blobId,
    attachments,
    totalPlaintextBytes: verified.handoffBytes + attachments.reduce((sum, attachment) => sum + attachment.bytes, 0),
  };
}
