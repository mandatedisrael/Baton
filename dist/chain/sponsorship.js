import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { fromBase64, normalizeSuiAddress, normalizeSuiObjectId, toBase64 } from "@mysten/sui/utils";
import { timingSafeEqual } from "node:crypto";
import { BatonError } from "../core/errors.js";
import { buildRegistrationTransaction, extractRegistrationObjects } from "./registration.js";
export const SPONSORED_REGISTRATION_GAS_BUDGET = 50000000n;
export async function buildSponsoredRegistrationBytes(input) {
    const gasBudget = input.gasBudget ?? SPONSORED_REGISTRATION_GAS_BUDGET;
    if (input.gasPrice <= 0n)
        throw new BatonError("INVALID_STATE", "sponsored gas price must be positive");
    if (gasBudget <= 0n || gasBudget > SPONSORED_REGISTRATION_GAS_BUDGET) {
        throw new BatonError("INVALID_STATE", `sponsored gas budget must be 1–${SPONSORED_REGISTRATION_GAS_BUDGET}`);
    }
    if (input.expirationEpoch <= 0n)
        throw new BatonError("INVALID_STATE", "sponsored expiration epoch must be positive");
    const tx = buildRegistrationTransaction(normalizeSuiObjectId(input.packageId), input.projectId);
    tx.setSender(normalizeSuiAddress(input.sender));
    tx.setGasOwner(normalizeSuiAddress(input.sponsor));
    // Address-balance sponsorship avoids mutable gas-coin references and lets
    // both parties sign exactly the same deterministic transaction bytes.
    tx.setGasPayment([]);
    tx.setGasPrice(input.gasPrice);
    tx.setGasBudget(gasBudget);
    tx.setExpiration({ Epoch: input.expirationEpoch.toString() });
    return tx.build();
}
export async function verifySponsoredRegistrationEnvelope(input) {
    const expiresAt = Date.parse(input.envelope.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= (input.now ?? new Date()).getTime()) {
        throw new BatonError("INVALID_STATE", "sponsored registration request has expired");
    }
    let gasPrice;
    let gasBudget;
    let expirationEpoch;
    try {
        gasPrice = BigInt(input.envelope.gasPrice);
        gasBudget = BigInt(input.envelope.gasBudget);
        expirationEpoch = BigInt(input.envelope.expirationEpoch);
    }
    catch {
        throw new BatonError("INVALID_STATE", "sponsor returned invalid gas metadata");
    }
    const expected = await buildSponsoredRegistrationBytes({
        packageId: input.packageId,
        projectId: input.projectId,
        sender: input.sender,
        sponsor: input.envelope.sponsor,
        gasPrice,
        gasBudget,
        expirationEpoch,
    });
    let received;
    try {
        received = fromBase64(input.envelope.transactionBytes);
    }
    catch (err) {
        throw new BatonError("INVALID_STATE", "sponsor returned invalid transaction bytes", { cause: err });
    }
    if (expected.byteLength !== received.byteLength || !timingSafeEqual(expected, received)) {
        throw new BatonError("INVALID_STATE", "sponsor transaction does not exactly match the requested Baton registration");
    }
    return received;
}
export async function executeSponsoredRegistration(input) {
    const user = await input.userKeypair.signTransaction(input.transactionBytes);
    return executeSponsoredRegistrationWithSignature({ ...input, userSignature: user.signature });
}
export async function executeSponsoredRegistrationWithSignature(input) {
    const sponsor = await input.sponsorKeypair.signTransaction(input.transactionBytes);
    const response = await input.client.executeTransactionBlock({
        transactionBlock: input.transactionBytes,
        signature: [input.userSignature, sponsor.signature],
        options: { showEffects: true, showObjectChanges: true },
    });
    if (response.effects?.status.status !== "success") {
        throw new BatonError("IO_ERROR", `sponsored registration failed: ${response.effects?.status.error ?? "unknown error"}`);
    }
    if (!response.objectChanges) {
        throw new BatonError("INVALID_STATE", "sponsored registration response omitted object changes");
    }
    const objects = extractRegistrationObjects(input.typePackageId, response.objectChanges);
    await input.client.waitForTransaction({ digest: response.digest });
    return { digest: response.digest, ...objects };
}
export function serializeSponsoredTransaction(bytes) {
    return toBase64(bytes);
}
//# sourceMappingURL=sponsorship.js.map