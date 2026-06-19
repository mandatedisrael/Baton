import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { normalizeSuiObjectId } from "@mysten/sui/utils";
import { BatonError } from "../core/errors.js";
function record(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new BatonError("INVALID_STATE", `on-chain ${label} is not an object`);
    }
    return value;
}
function fields(value, label) {
    return record(record(value, label).fields, `${label}.fields`);
}
function bytes(value, label, expectedLength) {
    if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
        throw new BatonError("INVALID_STATE", `on-chain ${label} is not a byte vector`);
    }
    if (expectedLength !== undefined && value.length !== expectedLength) {
        throw new BatonError("INVALID_STATE", `on-chain ${label} must contain ${expectedLength} bytes`);
    }
    return Uint8Array.from(value);
}
function text(value, label) {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes(value, label));
}
function integer(value, label, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new BatonError("INVALID_STATE", `on-chain ${label} is not a valid integer`);
    }
    return value;
}
export function parseRemoteManifestResponse(input) {
    const data = input.response.data;
    if (!data)
        throw new BatonError("NOT_FOUND", `baton ${input.handoffId} is not anchored on Sui`);
    if (data.content?.dataType !== "moveObject") {
        throw new BatonError("INVALID_STATE", "manifest dynamic field omitted Move object content");
    }
    const packageId = normalizeSuiObjectId(input.remote.packageId);
    const expectedType = `0x2::dynamic_field::Field<${packageId}::memory::ManifestKey, ${packageId}::memory::HandoffManifest>`;
    if (data.content.type !== expectedType || data.type !== expectedType) {
        throw new BatonError("INVALID_STATE", "manifest dynamic field has an unexpected Move type");
    }
    const owner = record(data.owner, "manifest owner");
    if (typeof owner.ObjectOwner !== "string" || owner.ObjectOwner.toLowerCase() !== input.remote.projectObjectId.toLowerCase()) {
        throw new BatonError("INVALID_STATE", "manifest dynamic field is not owned by the registered project");
    }
    const root = data.content.fields;
    const name = fields(root.name, "manifest name");
    const storedHash = Buffer.from(bytes(name.hash, "manifest hash", 32)).toString("hex");
    if (storedHash !== input.handoffId) {
        throw new BatonError("HASH_MISMATCH", `on-chain manifest key ${storedHash} does not match ${input.handoffId}`);
    }
    const value = fields(root.value, "manifest value");
    if (integer(value.version, "manifest version", 65_535) !== 1) {
        throw new BatonError("INVALID_STATE", `unsupported on-chain manifest version ${String(value.version)}`);
    }
    if (!Array.isArray(value.parent_hashes)) {
        throw new BatonError("INVALID_STATE", "on-chain parent hashes are not a vector");
    }
    if (!Array.isArray(value.attachments)) {
        throw new BatonError("INVALID_STATE", "on-chain attachments are not a vector");
    }
    const attachments = value.attachments.map((item, index) => {
        const attachment = fields(item, `attachment ${index}`);
        return {
            id: text(attachment.id, `attachment ${index} id`),
            kind: "attachment",
            contentHash: Buffer.from(bytes(attachment.content_hash, `attachment ${index} hash`, 32)).toString("hex"),
            blobId: text(attachment.blob_id, `attachment ${index} blob id`),
        };
    });
    if (new Set(attachments.map((attachment) => attachment.id)).size !== attachments.length) {
        throw new BatonError("INVALID_STATE", "on-chain attachment ids must be unique");
    }
    const fidelity = value.fidelity_bps;
    if (fidelity !== null && (!Number.isInteger(fidelity) || fidelity < 0 || fidelity > 10_000)) {
        throw new BatonError("INVALID_STATE", "on-chain fidelity score is invalid");
    }
    let timestampMs;
    try {
        timestampMs = BigInt(value.timestamp_ms);
    }
    catch {
        throw new BatonError("INVALID_STATE", "on-chain timestamp is invalid");
    }
    if (timestampMs < 0n)
        throw new BatonError("INVALID_STATE", "on-chain timestamp is invalid");
    return {
        handoffId: input.handoffId,
        handoff: {
            id: "handoff",
            kind: "handoff",
            contentHash: input.handoffId,
            blobId: text(value.handoff_blob_id, "handoff blob id"),
        },
        attachments,
        branch: text(value.branch, "branch"),
        parents: value.parent_hashes.map((parent, index) => Buffer.from(bytes(parent, `parent hash ${index}`, 32)).toString("hex")),
        fidelityBps: fidelity,
        graderModel: text(value.grader_model, "grader model"),
        rubricVersion: integer(value.rubric_version, "rubric version", 255),
        captureMode: integer(value.capture_mode, "capture mode", 3),
        tool: integer(value.tool, "tool", 4),
        timestampMs,
        anchorTx: typeof data.previousTransaction === "string"
            ? data.previousTransaction
            : (() => { throw new BatonError("INVALID_STATE", "manifest omitted its anchor transaction"); })(),
    };
}
export async function fetchRemoteManifest(input) {
    if (!/^[a-f0-9]{64}$/.test(input.handoffId)) {
        throw new BatonError("INVALID_HANDOFF", "remote baton id must be 64 lowercase hex characters");
    }
    let response;
    try {
        response = await input.client.getDynamicFieldObject({
            parentId: input.remote.projectObjectId,
            name: {
                type: `${normalizeSuiObjectId(input.remote.packageId)}::memory::ManifestKey`,
                value: { hash: [...Buffer.from(input.handoffId, "hex")] },
            },
        });
    }
    catch (err) {
        throw new BatonError("IO_ERROR", `failed to read Baton manifest from Sui: ${err instanceof Error ? err.message : String(err)}`, {
            cause: err,
        });
    }
    return parseRemoteManifestResponse({ response, remote: input.remote, handoffId: input.handoffId });
}
//# sourceMappingURL=manifest.js.map