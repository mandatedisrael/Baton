import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiObjectId } from "@mysten/sui/utils";
import { BatonError } from "../core/errors.js";
import { signTransactionWithZkLogin } from "./zklogin.js";
export function buildRegistrationTransaction(packageId, projectId) {
    const normalizedPackage = normalizeSuiObjectId(packageId);
    const projectBytes = new TextEncoder().encode(projectId);
    if (projectBytes.byteLength === 0 || projectBytes.byteLength > 128) {
        throw new BatonError("INVALID_STATE", "project id must encode to 1–128 UTF-8 bytes");
    }
    const tx = new Transaction();
    tx.moveCall({
        target: `${normalizedPackage}::memory::create_project`,
        arguments: [tx.pure.vector("u8", projectBytes)],
    });
    return tx;
}
export function extractRegistrationObjects(packageId, changes) {
    const packagePrefix = normalizeSuiObjectId(packageId);
    const created = changes.filter((change) => change.type === "created");
    const project = created.find((change) => change.objectType === `${packagePrefix}::memory::ProjectMemory`);
    const cap = created.find((change) => change.objectType === `${packagePrefix}::memory::OwnerCap`);
    if (!project || project.type !== "created" || !cap || cap.type !== "created") {
        throw new BatonError("INVALID_STATE", "registration transaction did not create ProjectMemory and OwnerCap");
    }
    return { projectObjectId: project.objectId, ownerCapId: cap.objectId };
}
export async function registerProjectOnSui(input) {
    const transaction = buildRegistrationTransaction(input.packageId, input.projectId);
    let response;
    if (input.identity && input.identity.scheme === "ZKLOGIN") {
        // Real zkLogin signing path (production)
        const sender = input.identity.session.address;
        transaction.setSender(sender);
        const zkSig = await signTransactionWithZkLogin({
            session: input.identity.session,
            client: input.client,
            transaction,
        });
        try {
            const bytes = await transaction.build({ client: input.client });
            response = await input.client.executeTransactionBlock({
                transactionBlock: bytes,
                signature: zkSig,
                options: { showEffects: true, showObjectChanges: true },
            });
        }
        catch (err) {
            throw new BatonError("IO_ERROR", `Sui zkLogin registration request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
    }
    else {
        // Legacy / ED25519 path
        const kp = input.keypair ?? input.identity?.keypair;
        if (!kp)
            throw new BatonError("INVALID_STATE", "No signer provided for registration");
        try {
            response = await input.client.signAndExecuteTransaction({
                transaction,
                signer: kp,
                options: { showEffects: true, showObjectChanges: true },
            });
        }
        catch (err) {
            throw new BatonError("IO_ERROR", `Sui registration request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
    }
    if (response.effects?.status.status !== "success") {
        throw new BatonError("IO_ERROR", `Sui registration failed: ${response.effects?.status.error ?? response.errors?.join("; ") ?? "unknown error"}`);
    }
    if (!response.objectChanges) {
        throw new BatonError("INVALID_STATE", "Sui registration response omitted object changes");
    }
    const objects = extractRegistrationObjects(input.typePackageId ?? input.packageId, response.objectChanges);
    try {
        await input.client.waitForTransaction({ digest: response.digest });
    }
    catch (err) {
        throw new BatonError("IO_ERROR", `registration executed but indexing timed out: ${response.digest}`, {
            cause: err,
        });
    }
    return { digest: response.digest, ...objects };
}
//# sourceMappingURL=registration.js.map