import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils";
import { BatonError } from "../core/errors.js";
import { signTransactionWithZkLogin } from "./zklogin.js";
import { getEd25519Keypair } from "./identity.js";
function ownerCap(remote) {
    if (remote.authority.kind !== "owner") {
        throw new BatonError("INVALID_STATE", "only the project owner can manage delegated access");
    }
    return remote.authority.capId;
}
export function buildGrantAccessTransaction(remote, grantee) {
    const address = normalizeSuiAddress(grantee);
    const tx = new Transaction();
    tx.moveCall({
        target: `${normalizeSuiObjectId(remote.policyPackageId)}::memory::grant_access`,
        arguments: [
            tx.object(remote.projectObjectId),
            tx.object(ownerCap(remote)),
            tx.pure.address(address),
        ],
    });
    return tx;
}
export function buildRevokeAccessTransaction(remote, grantee) {
    const address = normalizeSuiAddress(grantee);
    const tx = new Transaction();
    tx.moveCall({
        target: `${normalizeSuiObjectId(remote.policyPackageId)}::memory::revoke_access`,
        arguments: [
            tx.object(remote.projectObjectId),
            tx.object(ownerCap(remote)),
            tx.pure.address(address),
        ],
    });
    return tx;
}
export function extractGrantedAccessCap(packageId, grantee, changes) {
    const expectedType = `${normalizeSuiObjectId(packageId)}::memory::AccessCap`;
    const expectedOwner = normalizeSuiAddress(grantee);
    const created = changes.find((change) => change.type === "created" &&
        change.objectType === expectedType &&
        typeof change.owner === "object" &&
        change.owner !== null &&
        "AddressOwner" in change.owner &&
        normalizeSuiAddress(change.owner.AddressOwner) === expectedOwner);
    if (!created || created.type !== "created") {
        throw new BatonError("INVALID_STATE", "sharing transaction did not create the recipient AccessCap");
    }
    return created.objectId;
}
async function execute(client, loaded, transaction, label) {
    let response;
    try {
        if (loaded.scheme === "ZKLOGIN") {
            const zkSig = await signTransactionWithZkLogin({
                session: loaded.session,
                client,
                transaction,
            });
            const bytes = await transaction.build({ client });
            response = await client.executeTransactionBlock({
                transactionBlock: bytes,
                signature: zkSig,
                options: { showEffects: true, showObjectChanges: true },
            });
        }
        else {
            const keypair = getEd25519Keypair(loaded);
            response = await client.signAndExecuteTransaction({
                transaction,
                signer: keypair,
                options: { showEffects: true, showObjectChanges: true },
            });
        }
    }
    catch (err) {
        throw new BatonError("IO_ERROR", `${label} request failed: ${err instanceof Error ? err.message : String(err)}`, {
            cause: err,
        });
    }
    if (response.effects?.status.status !== "success") {
        throw new BatonError("IO_ERROR", `${label} failed: ${response.effects?.status.error ?? "unknown error"}`);
    }
    try {
        await client.waitForTransaction({ digest: response.digest });
    }
    catch (err) {
        throw new BatonError("IO_ERROR", `${label} executed but indexing timed out: ${response.digest}`, { cause: err });
    }
    return response;
}
export async function grantAccessOnSui(input) {
    const grantee = normalizeSuiAddress(input.grantee);
    const response = await execute(input.client, input.identity, buildGrantAccessTransaction(input.remote, grantee), "sharing transaction");
    if (!response.objectChanges) {
        throw new BatonError("INVALID_STATE", "sharing transaction omitted object changes");
    }
    return {
        digest: response.digest,
        accessCapId: extractGrantedAccessCap(input.remote.policyPackageId, grantee, response.objectChanges),
        grantee,
    };
}
export async function revokeAccessOnSui(input) {
    const response = await execute(input.client, input.identity, buildRevokeAccessTransaction(input.remote, input.grantee), "revocation transaction");
    return response.digest;
}
function moveFields(value) {
    if (!value || typeof value !== "object" || !("fields" in value)) {
        throw new BatonError("INVALID_STATE", "Sui object response omitted Move fields");
    }
    const fields = value.fields;
    if (!fields || typeof fields !== "object")
        throw new BatonError("INVALID_STATE", "Sui Move fields are invalid");
    return fields;
}
/** Verify recipient ownership and the current on-chain revocation record. */
export async function verifyDelegatedAccess(input) {
    if (input.remote.authority.kind !== "delegate") {
        throw new BatonError("INVALID_STATE", "invitation does not contain delegated authority");
    }
    const grantee = normalizeSuiAddress(input.grantee);
    const packageId = normalizeSuiObjectId(input.remote.policyPackageId);
    const cap = await input.client.getObject({
        id: input.remote.authority.capId,
        options: { showContent: true, showOwner: true, showType: true },
    });
    if (cap.error || !cap.data)
        throw new BatonError("NOT_FOUND", "delegated AccessCap was not found on Sui");
    if (cap.data.type !== `${packageId}::memory::AccessCap`) {
        throw new BatonError("INVALID_STATE", "invitation capability has the wrong on-chain type");
    }
    const owner = cap.data.owner;
    if (!owner || typeof owner !== "object" || !("AddressOwner" in owner) || normalizeSuiAddress(owner.AddressOwner) !== grantee) {
        throw new BatonError("INVALID_STATE", "delegated AccessCap is not owned by this Baton identity");
    }
    if (!cap.data.content || cap.data.content.dataType !== "moveObject") {
        throw new BatonError("INVALID_STATE", "delegated AccessCap content is unavailable");
    }
    const capFields = moveFields(cap.data.content);
    if (normalizeSuiObjectId(String(capFields.project)) !== normalizeSuiObjectId(input.remote.projectObjectId)) {
        throw new BatonError("INVALID_STATE", "delegated AccessCap belongs to another project");
    }
    if (normalizeSuiAddress(String(capFields.grantee)) !== grantee) {
        throw new BatonError("INVALID_STATE", "delegated AccessCap names another recipient");
    }
    const record = await input.client.getDynamicFieldObject({
        parentId: input.remote.projectObjectId,
        name: { type: `${packageId}::memory::AccessKey`, value: { grantee } },
    });
    if (record.error || !record.data?.content || record.data.content.dataType !== "moveObject") {
        throw new BatonError("INVALID_STATE", "delegated access is not active on this project");
    }
    const field = moveFields(record.data.content);
    const value = moveFields(field.value);
    if (value.active !== true || String(value.generation) !== String(capFields.generation)) {
        throw new BatonError("INVALID_STATE", "delegated access has been revoked or superseded");
    }
}
//# sourceMappingURL=sharing.js.map