import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiObjectId } from "@mysten/sui/utils";
import { BatonError } from "../core/errors.js";
import { hashCanonical } from "../core/hash.js";
import { CAPTURE_MODES, TOOL_IDS } from "../schema/handoff.js";
import { parseUploadJob } from "../schema/remote.js";
import { ProjectStore } from "../store/project.js";
import { markPublicationFailed } from "./encryption.js";
const utf8 = (value) => new TextEncoder().encode(value);
function hashBytes(value, label) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
        throw new BatonError("INVALID_HANDOFF", `${label} must be 64 lowercase hex characters`);
    }
    return Uint8Array.from(Buffer.from(value, "hex"));
}
function rubricVersion(value) {
    if (value === undefined)
        return 0;
    const match = /^v(\d+)$/.exec(value);
    const version = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(version) || version < 1 || version > 255) {
        throw new BatonError("INVALID_HANDOFF", `unsupported fidelity rubric version: ${value}`);
    }
    return version;
}
function uploadedBlob(job, id) {
    const blob = job.blobs.find((item) => item.id === id);
    if (!blob || blob.status !== "uploaded" || blob.blobId === null) {
        throw new BatonError("INVALID_STATE", `queue blob ${id} is not uploaded`);
    }
    return blob;
}
export function buildAnchorTransaction(input) {
    if (input.remote.authority.kind !== "owner") {
        throw new BatonError("INVALID_STATE", "delegated readers cannot anchor handoffs");
    }
    if (hashCanonical(input.handoff) !== input.handoffId || input.job.handoffId !== input.handoffId) {
        throw new BatonError("HASH_MISMATCH", "handoff, queue, and anchor identity do not match");
    }
    if (input.job.blobs.some((blob) => blob.status !== "uploaded")) {
        throw new BatonError("INVALID_STATE", "every encrypted payload must be certified on Walrus before anchoring");
    }
    const handoffBlob = uploadedBlob(input.job, "handoff");
    const branch = input.handoff.meta.branch ?? "main";
    if (utf8(branch).byteLength === 0 || utf8(branch).byteLength > 255) {
        throw new BatonError("INVALID_HANDOFF", "branch must encode to 1–255 UTF-8 bytes");
    }
    const graderModel = input.handoff.fidelity.graderModel ?? "";
    if (utf8(graderModel).byteLength > 128) {
        throw new BatonError("INVALID_HANDOFF", "grader model exceeds the on-chain 128-byte bound");
    }
    const attachments = input.handoff.attachments.map((attachment) => {
        const blob = uploadedBlob(input.job, attachment.id);
        if (blob.contentHash !== attachment.contentHash) {
            throw new BatonError("HASH_MISMATCH", `attachment ${attachment.id} does not match its queue metadata`);
        }
        return { attachment, blobId: blob.blobId };
    });
    const tx = new Transaction();
    tx.moveCall({
        target: `${normalizeSuiObjectId(input.remote.policyPackageId)}::memory::anchor_handoff`,
        arguments: [
            tx.object(input.remote.projectObjectId),
            tx.object(input.remote.authority.capId),
            tx.pure.vector("u8", hashBytes(input.handoffId, "handoff id")),
            tx.pure.vector("u8", utf8(branch)),
            tx.pure.vector("u8", utf8(handoffBlob.blobId)),
            tx.pure.vector("vector<u8>", input.handoff.meta.parents.map((parent) => [...hashBytes(parent, "parent id")])),
            tx.pure.bool(input.handoff.fidelity.score !== null),
            tx.pure.u16(input.handoff.fidelity.score === null ? 0 : Math.round(input.handoff.fidelity.score * 10_000)),
            tx.pure.vector("u8", utf8(graderModel)),
            tx.pure.u8(rubricVersion(input.handoff.fidelity.rubricVersion)),
            tx.pure.u8(CAPTURE_MODES.indexOf(input.handoff.meta.captureMode)),
            tx.pure.u8(TOOL_IDS.indexOf(input.handoff.meta.tool)),
            tx.pure.u64(BigInt(Date.parse(input.handoff.meta.timestamp))),
            tx.pure.vector("vector<u8>", attachments.map(({ attachment }) => [...utf8(attachment.id)])),
            tx.pure.vector("vector<u8>", attachments.map(({ blobId }) => [...utf8(blobId)])),
            tx.pure.vector("vector<u8>", attachments.map(({ attachment }) => [...hashBytes(attachment.contentHash, "attachment hash")])),
        ],
    });
    return tx;
}
function byteVector(value) {
    if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item < 0 || item > 255))
        return null;
    return Uint8Array.from(value);
}
/** Verify a previously created dynamic field before treating an interrupted anchor as complete. */
export function extractExistingAnchor(response, expectedHash, expectedBlobId) {
    const data = response.data;
    if (!data || data.content?.dataType !== "moveObject")
        return null;
    const fields = data.content.fields;
    const name = fields.name?.fields;
    const value = fields.value?.fields;
    const storedHash = byteVector(name?.hash);
    const storedBlob = byteVector(value?.handoff_blob_id);
    if (!storedHash || Buffer.from(storedHash).toString("hex") !== expectedHash) {
        throw new BatonError("HASH_MISMATCH", "existing on-chain manifest has an unexpected content hash");
    }
    if (!storedBlob || new TextDecoder().decode(storedBlob) !== expectedBlobId) {
        throw new BatonError("HASH_MISMATCH", "existing on-chain manifest points to a different Walrus blob");
    }
    if (!data.previousTransaction) {
        throw new BatonError("INVALID_STATE", "existing on-chain manifest omitted its creation transaction");
    }
    return data.previousTransaction;
}
async function existingAnchorDigest(client, remote, handoffId, handoffBlobId) {
    const response = await client.getDynamicFieldObject({
        parentId: remote.projectObjectId,
        name: {
            type: `${normalizeSuiObjectId(remote.packageId)}::memory::ManifestKey`,
            value: { hash: [...hashBytes(handoffId, "handoff id")] },
        },
    });
    return extractExistingAnchor(response, handoffId, handoffBlobId);
}
async function submitAnchor(input) {
    const handoffBlobId = uploadedBlob(input.job, "handoff").blobId;
    const existing = await existingAnchorDigest(input.client, input.remote, input.handoffId, handoffBlobId);
    if (existing)
        return existing;
    const transaction = buildAnchorTransaction(input);
    const response = await input.client.signAndExecuteTransaction({
        transaction,
        signer: input.keypair,
        options: { showEffects: true },
    });
    if (response.effects?.status.status !== "success") {
        throw new BatonError("IO_ERROR", `Sui anchoring failed: ${response.effects?.status.error ?? "unknown error"}`);
    }
    await input.client.waitForTransaction({ digest: response.digest });
    return response.digest;
}
export async function anchorQueuedJob(input) {
    const now = input.now ?? new Date();
    let job = input.store.loadUploadJob(input.handoffId);
    if (job.status === "complete")
        return { job, sidecar: input.store.loadRemoteSidecar(input.handoffId) };
    if (!job.blobs.every((blob) => blob.status === "uploaded")) {
        throw new BatonError("INVALID_STATE", "all queue blobs must be uploaded before anchoring");
    }
    const handoff = input.store.loadHandoff(input.handoffId);
    try {
        const digest = await submitAnchor({ ...input, handoff, job });
        const handoffBlob = uploadedBlob(job, "handoff");
        const sidecar = {
            schemaVersion: 1,
            handoffId: input.handoffId,
            handoffBlobId: handoffBlob.blobId,
            attachments: job.blobs
                .filter((blob) => blob.kind === "attachment")
                .map((blob) => ({ id: blob.id, contentHash: blob.contentHash, blobId: blob.blobId })),
            anchor: {
                network: input.remote.network,
                projectObjectId: input.remote.projectObjectId,
                txDigest: digest,
                anchoredAt: now.toISOString(),
            },
        };
        // Write the immutable publication receipt before marking the queue done.
        input.store.saveRemoteSidecar(sidecar);
        job = parseUploadJob({
            ...job,
            status: "complete",
            updatedAt: now.toISOString(),
            lastError: null,
            anchor: { status: "anchored", txDigest: digest },
        });
        input.store.saveUploadJob(job);
        return { job, sidecar };
    }
    catch (err) {
        job = markPublicationFailed(job, err, now);
        input.store.saveUploadJob(job);
        return { job, sidecar: null };
    }
}
//# sourceMappingURL=anchor.js.map