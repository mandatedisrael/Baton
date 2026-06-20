import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { fetchRemoteManifest } from "../chain/manifest.js";
import { recoverRemoteHandoff, verifyRemoteHandoff } from "../chain/recovery.js";
import { createWalrusRetriever } from "../chain/retrieval.js";
import { loadIdentity, getIdentityAddress, requireEd25519Identity, isZkLoginIdentity } from "../chain/identity.js";
import { loadEphemeralFromSession } from "../chain/zklogin.js";
import { createSealPayloadDecryptor } from "../chain/seal.js";
import { BatonError } from "../core/errors.js";
import { ProjectStore } from "../store/project.js";
export async function ensureHandoffAvailable(store, id, recoverer) {
    try {
        const handoff = store.loadHandoff(id);
        for (const attachment of handoff.attachments) {
            try {
                store.loadAttachment(attachment);
            }
            catch (err) {
                if (err instanceof BatonError && err.code === "NOT_FOUND")
                    return recoverer(id);
                throw err;
            }
        }
        return handoff;
    }
    catch (err) {
        if (!(err instanceof BatonError) || err.code !== "NOT_FOUND")
            throw err;
    }
    return recoverer(id);
}
export async function recoverHandoffFromRemote(store, handoffId, identityPath) {
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
    const keypair = isZkLoginIdentity(loaded)
        ? loadEphemeralFromSession(loaded.session)
        : requireEd25519Identity(loaded).keypair;
    const decryptor = createSealPayloadDecryptor({
        network: remote.network,
        rpcUrl: remote.rpcUrl,
        serverConfigs: remote.seal.serverConfigs,
        keypair,
    });
    return recoverRemoteHandoff({ store, manifest, remote, retriever, decryptor });
}
export async function auditHandoffFromRemote(store, handoffId, identityPath) {
    if (!/^[a-f0-9]{64}$/.test(handoffId)) {
        throw new BatonError("INVALID_HANDOFF", "remote audit requires a full 64-character baton id");
    }
    const remote = store.config().remote;
    if (!remote)
        throw new BatonError("INVALID_STATE", "project is local-only — register it before remote audit");
    const loaded = loadIdentity(identityPath);
    const client = new SuiJsonRpcClient({ network: remote.network, url: remote.rpcUrl });
    const manifest = await fetchRemoteManifest({ client, remote, handoffId });
    const retriever = createWalrusRetriever({ aggregatorUrl: remote.walrus.aggregatorUrl });
    const keypair = isZkLoginIdentity(loaded)
        ? loadEphemeralFromSession(loaded.session)
        : requireEd25519Identity(loaded).keypair;
    const decryptor = createSealPayloadDecryptor({
        network: remote.network,
        rpcUrl: remote.rpcUrl,
        serverConfigs: remote.seal.serverConfigs,
        keypair,
    });
    const verified = await verifyRemoteHandoff({ store, manifest, remote, retriever, decryptor });
    const attachments = verified.attachments.map((attachment) => ({
        id: manifest.attachments[attachment.index].id,
        blobId: manifest.attachments[attachment.index].blobId,
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
//# sourceMappingURL=remote.js.map