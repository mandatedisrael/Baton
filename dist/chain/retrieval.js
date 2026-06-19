import { BatonError } from "../core/errors.js";
import { hashBytes } from "../core/hash.js";
export function validateWalrusBlobId(blobId) {
    if (!/^[A-Za-z0-9_-]{20,256}$/.test(blobId)) {
        throw new BatonError("INVALID_STATE", "Walrus blob id must be canonical base64url text");
    }
    return blobId;
}
export function createWalrusRetriever(options) {
    const base = new URL(options.aggregatorUrl);
    if (base.protocol !== "https:") {
        throw new BatonError("INVALID_STATE", "Walrus aggregator must use HTTPS");
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || !Number.isInteger(maxBytes) || maxBytes < 1) {
        throw new BatonError("INVALID_STATE", "Walrus retrieval limits must be positive integers");
    }
    return {
        async fetch(blobId) {
            validateWalrusBlobId(blobId);
            const url = new URL(`/v1/blobs/${encodeURIComponent(blobId)}`, base);
            let response;
            try {
                response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
            }
            catch (err) {
                throw new BatonError("IO_ERROR", `Walrus retrieval failed for ${blobId}: ${err instanceof Error ? err.message : String(err)}`, {
                    cause: err,
                });
            }
            if (!response.ok) {
                throw new BatonError(response.status === 404 ? "NOT_FOUND" : "IO_ERROR", `Walrus aggregator returned HTTP ${response.status} for ${blobId}`);
            }
            const declared = response.headers.get("content-length");
            if (declared !== null && Number(declared) > maxBytes) {
                throw new BatonError("INVALID_STATE", `Walrus blob ${blobId} exceeds the ${maxBytes}-byte retrieval limit`);
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.byteLength > maxBytes) {
                throw new BatonError("INVALID_STATE", `Walrus blob ${blobId} exceeds the ${maxBytes}-byte retrieval limit`);
            }
            return bytes;
        },
    };
}
export async function fetchVerifiedCiphertext(input) {
    const bytes = await input.retriever.fetch(input.blobId);
    if (input.encryptedHash !== undefined) {
        const actual = hashBytes(bytes);
        if (actual !== input.encryptedHash) {
            throw new BatonError("HASH_MISMATCH", `Walrus ciphertext ${input.blobId} hashes to ${actual}, expected ${input.encryptedHash}`);
        }
    }
    return bytes;
}
//# sourceMappingURL=retrieval.js.map