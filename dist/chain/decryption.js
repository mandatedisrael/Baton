import { BatonError } from "../core/errors.js";
import { hashBytes } from "../core/hash.js";
import { sealIdentity } from "./encryption.js";
export async function decryptBlob(input) {
    const plaintext = await input.decryptor.decrypt({
        packageId: input.packageId,
        policyPackageId: input.policyPackageId,
        projectObjectId: input.projectObjectId,
        authority: input.authority,
        handoffId: input.handoffId,
        identity: sealIdentity(input.projectObjectId, input.handoffId),
        data: input.ciphertext,
    });
    const actual = hashBytes(plaintext);
    if (actual !== input.blob.contentHash) {
        throw new BatonError("HASH_MISMATCH", `decrypted ${input.blob.kind} ${input.blob.id} hashes to ${actual}, expected ${input.blob.contentHash}`);
    }
    return plaintext;
}
//# sourceMappingURL=decryption.js.map