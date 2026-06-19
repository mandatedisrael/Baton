/**
 * ProjectStore — local persistence for one project.
 *
 * Two principles, established here in phase 1 and never relaxed:
 *
 *  1. Verify-on-read: every handoff loaded from disk is re-hashed and
 *     compared to its filename id. A mismatch is a loud HASH_MISMATCH —
 *     the local echo of verify-on-resume (plan §2.3).
 *  2. Atomic writes: state and config are written via tmp-file + rename,
 *     so a crash mid-write never corrupts the store.
 *
 * NOTE: the local cache is plaintext-with-0600 in phase 1. At-rest
 * encryption of local state arrives with Seal integration (phase 3).
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { BatonError } from "../core/errors.js";
import { hashBytes, hashCanonical } from "../core/hash.js";
import { emptyWorkingState } from "../core/working-state.js";
import { parseHandoff } from "../schema/handoff.js";
import { parseProjectConfig, } from "../schema/project.js";
import { parseRemoteSidecar, parseUploadJob, } from "../schema/remote.js";
import { nullable, obj, str } from "../schema/validate.js";
import { batonDir, attachmentPath, attachmentsDir, configPath, cursorPath, encryptedPayloadPath, findProjectRoot, handoffPath, handoffsDir, queueDir, remoteDir, remoteSidecarPath, uploadJobPath, workingStatePath, } from "./paths.js";
export const EMPTY_CURSOR = { sessionId: null, line: 0, transcriptPath: null };
export class ProjectStore {
    root;
    constructor(root) {
        this.root = root;
    }
    /** Create .baton/ in `root`. Errors if already initialized. */
    static init(root, now = new Date()) {
        if (existsSync(batonDir(root))) {
            throw new BatonError("ALREADY_INITIALIZED", `already a baton project: ${batonDir(root)}`);
        }
        mkdirSync(handoffsDir(root), { recursive: true });
        mkdirSync(attachmentsDir(root), { recursive: true });
        mkdirSync(queueDir(root), { recursive: true });
        mkdirSync(remoteDir(root), { recursive: true });
        mkdirSync(dirname(workingStatePath(root)), { recursive: true });
        const store = new ProjectStore(root);
        store.writeConfig({
            schemaVersion: 1,
            projectId: randomUUID(),
            createdAt: now.toISOString(),
            head: null,
            remote: null,
        });
        store.saveWorkingState(emptyWorkingState(now));
        return store;
    }
    /** Open the project containing `cwd` (walks up). Errors if none found. */
    static open(cwd) {
        const root = findProjectRoot(cwd);
        if (root === null) {
            throw new BatonError("NOT_INITIALIZED", "not a baton project (no .baton directory here or in any parent) — run `baton init`");
        }
        return new ProjectStore(root);
    }
    // -- config ---------------------------------------------------------------
    config() {
        try {
            return parseProjectConfig(this.readJson(configPath(this.root)));
        }
        catch (err) {
            if (err instanceof BatonError)
                throw err;
            throw new BatonError("INVALID_STATE", "config.json is invalid", { cause: err });
        }
    }
    setHead(id) {
        this.writeConfig({ ...this.config(), head: id });
    }
    setRemoteConfig(remote) {
        const config = parseProjectConfig({ ...this.config(), remote });
        this.writeConfig(config);
    }
    joinRemoteProject(projectId, head, remote) {
        const config = this.config();
        if (config.remote || config.head || this.listHandoffIds().length > 0 || this.listUploadJobs().length > 0) {
            throw new BatonError("INVALID_STATE", "refusing to replace a non-empty Baton project with an invitation");
        }
        this.writeConfig(parseProjectConfig({ ...config, projectId, head, remote }));
    }
    // -- working state ----------------------------------------------------------
    loadWorkingState() {
        return this.readJson(workingStatePath(this.root));
    }
    // -- checkpoint cursor ------------------------------------------------------
    /** Where the distiller left off. Returns the empty cursor if none yet. */
    loadCursor() {
        if (!existsSync(cursorPath(this.root)))
            return { ...EMPTY_CURSOR };
        try {
            const r = obj(this.readJson(cursorPath(this.root)), "cursor", ["sessionId", "line", "transcriptPath"]);
            return {
                sessionId: nullable(r.sessionId, "cursor.sessionId", (s, p) => str(s, p)),
                line: typeof r.line === "number" && Number.isInteger(r.line) && r.line >= 0 ? r.line : 0,
                transcriptPath: nullable(r.transcriptPath ?? null, "cursor.transcriptPath", (s, p) => str(s, p)),
            };
        }
        catch {
            return { ...EMPTY_CURSOR }; // a corrupt cursor just means "redistill from the start"
        }
    }
    saveCursor(cursor) {
        this.writeJsonAtomic(cursorPath(this.root), cursor);
    }
    saveWorkingState(state) {
        this.writeJsonAtomic(workingStatePath(this.root), state);
    }
    // -- handoffs ----------------------------------------------------------------
    /** Persist a finalized handoff. The id is recomputed and must match. */
    saveHandoff(handoff, id) {
        const actual = hashCanonical(handoff);
        if (actual !== id) {
            throw new BatonError("HASH_MISMATCH", `handoff hash ${actual} does not match id ${id}`);
        }
        this.writeJsonAtomic(handoffPath(this.root, id), handoff);
    }
    /** Load + validate + verify a handoff. Loud refusal on tampering. */
    loadHandoff(id) {
        const path = handoffPath(this.root, id);
        if (!existsSync(path)) {
            throw new BatonError("NOT_FOUND", `no handoff ${id}`);
        }
        const handoff = parseHandoff(this.readJson(path));
        const actual = hashCanonical(handoff);
        if (actual !== id) {
            throw new BatonError("HASH_MISMATCH", `handoff ${id} failed verification (content hashes to ${actual}) — refusing to use it`);
        }
        return handoff;
    }
    /** All handoff ids on disk (unordered; callers sort by timestamp). */
    listHandoffIds() {
        const dir = handoffsDir(this.root);
        if (!existsSync(dir))
            return [];
        return readdirSync(dir)
            .filter((f) => f.endsWith(".json"))
            .map((f) => f.slice(0, -".json".length));
    }
    // -- attachments -----------------------------------------------------------
    /**
     * Persist attachment bytes under their content hash. Existing bytes are
     * verified and reused, making retries idempotent.
     */
    saveAttachment(attachment, data) {
        const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
        this.validateAttachmentBytes(attachment, bytes);
        const path = this.verifiedAttachmentPath(attachment.contentHash);
        if (existsSync(path)) {
            this.loadAttachment(attachment);
            return;
        }
        this.writeBytesAtomic(path, bytes);
    }
    /** Load attachment bytes and loudly refuse missing or tampered content. */
    loadAttachment(attachment) {
        const path = this.verifiedAttachmentPath(attachment.contentHash);
        if (!existsSync(path)) {
            throw new BatonError("NOT_FOUND", `attachment ${attachment.id} is not available locally`);
        }
        let bytes;
        try {
            bytes = readFileSync(path);
        }
        catch (err) {
            throw new BatonError("IO_ERROR", `failed reading attachment ${attachment.id}`, { cause: err });
        }
        this.validateAttachmentBytes(attachment, bytes);
        return bytes;
    }
    // -- remote publication queue ---------------------------------------------
    saveUploadJob(job) {
        const parsed = parseUploadJob(job);
        this.writeJsonAtomic(uploadJobPath(this.root, parsed.handoffId), parsed);
    }
    /** Create a queue entry without resetting progress from an earlier attempt. */
    enqueueUploadJob(job) {
        const parsed = parseUploadJob(job);
        const path = uploadJobPath(this.root, parsed.handoffId);
        if (existsSync(path))
            return this.loadUploadJob(parsed.handoffId);
        this.writeJsonAtomic(path, parsed);
        return parsed;
    }
    loadUploadJob(handoffId) {
        const path = uploadJobPath(this.root, this.verifiedContentId(handoffId));
        if (!existsSync(path))
            throw new BatonError("NOT_FOUND", `no upload job for baton ${handoffId}`);
        try {
            return parseUploadJob(this.readJson(path));
        }
        catch (err) {
            if (err instanceof BatonError)
                throw err;
            throw new BatonError("INVALID_STATE", `upload job ${handoffId} is invalid`, { cause: err });
        }
    }
    listUploadJobs() {
        const dir = queueDir(this.root);
        if (!existsSync(dir))
            return [];
        return readdirSync(dir)
            .filter((name) => name.endsWith(".json"))
            .map((name) => this.loadUploadJob(name.slice(0, -".json".length)))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    saveEncryptedPayload(job, blobId, data) {
        const blob = job.blobs.find((item) => item.id === blobId);
        if (!blob)
            throw new BatonError("NOT_FOUND", `upload job has no blob ${blobId}`);
        if (blob.status === "pending" || blob.encryptedHash === null) {
            throw new BatonError("INVALID_STATE", `blob ${blobId} has not been encrypted`);
        }
        const actual = hashBytes(data);
        if (actual !== blob.encryptedHash) {
            throw new BatonError("HASH_MISMATCH", `encrypted blob ${blobId} hashes to ${actual}, expected ${blob.encryptedHash}`);
        }
        this.writeBytesAtomic(encryptedPayloadPath(this.root, this.verifiedContentId(job.handoffId), this.verifiedContentId(blob.contentHash)), data);
    }
    loadEncryptedPayload(job, blobId) {
        const blob = job.blobs.find((item) => item.id === blobId);
        if (!blob)
            throw new BatonError("NOT_FOUND", `upload job has no blob ${blobId}`);
        if (blob.status === "pending" || blob.encryptedHash === null) {
            throw new BatonError("INVALID_STATE", `blob ${blobId} has not been encrypted`);
        }
        const path = encryptedPayloadPath(this.root, this.verifiedContentId(job.handoffId), this.verifiedContentId(blob.contentHash));
        if (!existsSync(path))
            throw new BatonError("NOT_FOUND", `encrypted payload ${blobId} is missing`);
        let data;
        try {
            data = readFileSync(path);
        }
        catch (err) {
            throw new BatonError("IO_ERROR", `failed reading encrypted payload ${blobId}`, { cause: err });
        }
        const actual = hashBytes(data);
        if (actual !== blob.encryptedHash) {
            throw new BatonError("HASH_MISMATCH", `encrypted payload ${blobId} failed verification (content hashes to ${actual})`);
        }
        return data;
    }
    saveRemoteSidecar(sidecar) {
        const parsed = parseRemoteSidecar(sidecar);
        this.writeJsonAtomic(remoteSidecarPath(this.root, parsed.handoffId), parsed);
    }
    loadRemoteSidecar(handoffId) {
        const path = remoteSidecarPath(this.root, this.verifiedContentId(handoffId));
        if (!existsSync(path))
            throw new BatonError("NOT_FOUND", `baton ${handoffId} has no remote publication`);
        try {
            return parseRemoteSidecar(this.readJson(path));
        }
        catch (err) {
            if (err instanceof BatonError)
                throw err;
            throw new BatonError("INVALID_STATE", `remote metadata for ${handoffId} is invalid`, { cause: err });
        }
    }
    // -- internals ----------------------------------------------------------------
    readJson(path) {
        try {
            return JSON.parse(readFileSync(path, "utf8"));
        }
        catch (err) {
            throw new BatonError("IO_ERROR", `failed reading ${path}`, { cause: err });
        }
    }
    writeConfig(config) {
        this.writeJsonAtomic(configPath(this.root), config);
    }
    verifiedAttachmentPath(contentHash) {
        return attachmentPath(this.root, this.verifiedContentId(contentHash));
    }
    verifiedContentId(value) {
        if (!/^[a-f0-9]{64}$/.test(value)) {
            throw new BatonError("INVALID_HANDOFF", "content id must be 64 lowercase hex characters");
        }
        return value;
    }
    validateAttachmentBytes(attachment, bytes) {
        if (bytes.byteLength !== attachment.bytes) {
            throw new BatonError("HASH_MISMATCH", `attachment ${attachment.id} expected ${attachment.bytes} bytes, received ${bytes.byteLength}`);
        }
        const actual = hashBytes(bytes);
        if (actual !== attachment.contentHash) {
            throw new BatonError("HASH_MISMATCH", `attachment ${attachment.id} failed verification (content hashes to ${actual})`);
        }
    }
    writeBytesAtomic(path, value) {
        const tmp = `${path}.tmp`;
        try {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(tmp, value, { mode: 0o600 });
            renameSync(tmp, path);
        }
        catch (err) {
            throw new BatonError("IO_ERROR", `failed writing ${path}`, { cause: err });
        }
    }
    writeJsonAtomic(path, value) {
        const tmp = `${path}.tmp`;
        try {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
            renameSync(tmp, path);
        }
        catch (err) {
            throw new BatonError("IO_ERROR", `failed writing ${path}`, { cause: err });
        }
    }
}
//# sourceMappingURL=project.js.map