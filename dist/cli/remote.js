import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { fetchRemoteManifest } from "../chain/manifest.js";
import { recoverRemoteHandoff } from "../chain/recovery.js";
import { createWalrusRetriever } from "../chain/retrieval.js";
import { loadIdentity } from "../chain/identity.js";
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
    const { keypair } = loadIdentity(identityPath);
    const client = new SuiJsonRpcClient({ network: remote.network, url: remote.rpcUrl });
    const manifest = await fetchRemoteManifest({ client, remote, handoffId });
    const retriever = createWalrusRetriever({ aggregatorUrl: remote.walrus.aggregatorUrl });
    const decryptor = createSealPayloadDecryptor({
        network: remote.network,
        rpcUrl: remote.rpcUrl,
        serverConfigs: remote.seal.serverConfigs,
        keypair,
    });
    return recoverRemoteHandoff({ store, manifest, remote, retriever, decryptor });
}
//# sourceMappingURL=remote.js.map