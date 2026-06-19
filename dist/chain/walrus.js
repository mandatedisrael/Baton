import { SuiGrpcClient } from "@mysten/sui/grpc";
import { walrus } from "@mysten/walrus";
import { BatonError } from "../core/errors.js";
/**
 * Drive an official Walrus write flow and durably expose every resumable step.
 * A blob is successful only after the SDK returns its certified checkpoint.
 */
export async function runWalrusWriteFlow(flow, input) {
    let certifiedBlobId = null;
    for await (const step of flow.run({
        signer: input.keypair,
        epochs: input.epochs,
        deletable: input.deletable,
    })) {
        if (step.step === "certified") {
            certifiedBlobId = step.blobId;
        }
        else {
            await input.onCheckpoint(step);
        }
    }
    if (certifiedBlobId === null) {
        throw new BatonError("INVALID_STATE", "Walrus write flow ended before blob certification");
    }
    return { blobId: certifiedBlobId };
}
/** Create a production uploader backed by Mysten's Walrus SDK and relay. */
export function createWalrusUploader(input) {
    const client = new SuiGrpcClient({
        network: input.remote.network,
        baseUrl: input.remote.rpcUrl,
    }).$extend(walrus({
        uploadRelay: {
            host: input.remote.walrus.uploadRelayUrl,
            sendTip: { max: input.remote.walrus.maxTipMist },
        },
        storageNodeClientOptions: { timeout: 60_000 },
    }));
    return {
        async upload(request) {
            const flow = client.walrus.writeBlobFlow({
                blob: request.data,
                ...(request.resume ? { resume: request.resume } : {}),
            });
            try {
                return await runWalrusWriteFlow(flow, {
                    keypair: input.keypair,
                    epochs: input.remote.walrus.epochs,
                    deletable: input.remote.walrus.deletable,
                    onCheckpoint: request.onCheckpoint,
                });
            }
            catch (err) {
                if (err instanceof BatonError)
                    throw err;
                const message = err instanceof Error ? err.message : String(err);
                throw new BatonError("IO_ERROR", `Walrus upload failed: ${message}. The Baton identity must hold SUI for gas and WAL for storage`, { cause: err });
            }
        },
    };
}
//# sourceMappingURL=walrus.js.map