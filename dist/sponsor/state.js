import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { BatonError } from "../core/errors.js";
export function defaultSponsorStatePath(home = homedir()) {
    return join(home, ".baton", "sponsor.json");
}
export function acquireSponsorStateLock(path = defaultSponsorStatePath()) {
    const lockPath = `${path}.lock`;
    const dir = dirname(lockPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const create = () => {
        try {
            const descriptor = openSync(lockPath, "wx", 0o600);
            writeFileSync(descriptor, `${process.pid}\n`, "utf8");
            return descriptor;
        }
        catch (err) {
            if (!existsSync(lockPath))
                throw err;
            if (lstatSync(lockPath).isSymbolicLink())
                throw new BatonError("INVALID_STATE", `refusing symlinked sponsor lock: ${lockPath}`);
            const owner = Number(readFileSync(lockPath, "utf8").trim());
            if (Number.isInteger(owner) && owner > 0) {
                try {
                    process.kill(owner, 0);
                    throw new BatonError("INVALID_STATE", `sponsor state is already in use by process ${owner}`);
                }
                catch (probe) {
                    if (probe instanceof BatonError)
                        throw probe;
                    if (probe.code !== "ESRCH") {
                        throw new BatonError("INVALID_STATE", `cannot verify sponsor lock owner ${owner}`, { cause: probe });
                    }
                }
            }
            unlinkSync(lockPath);
            return create();
        }
    };
    const descriptor = create();
    let released = false;
    return () => {
        if (released)
            return;
        released = true;
        closeSync(descriptor);
        try {
            unlinkSync(lockPath);
        }
        catch (err) {
            if (err.code !== "ENOENT")
                throw err;
        }
    };
}
export async function withSponsorStateLock(path, operation, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    let release;
    while (!release) {
        try {
            release = acquireSponsorStateLock(path);
        }
        catch (err) {
            if (!(err instanceof BatonError) || !err.message.includes("already in use by process") || Date.now() >= deadline)
                throw err;
            await delay(25);
        }
    }
    try {
        return await operation();
    }
    finally {
        release();
    }
}
function projectId(value) {
    const bytes = new TextEncoder().encode(value);
    if (bytes.byteLength === 0 || bytes.byteLength > 128)
        throw new BatonError("INVALID_STATE", "project id must encode to 1–128 UTF-8 bytes");
    return value;
}
function hashToken(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new BatonError("INVALID_STATE", "invalid sponsor invitation token");
    return createHash("sha256").update(token).digest("hex");
}
function parseReservation(value, index) {
    if (value === null)
        return null;
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new BatonError("INVALID_STATE", `invalid sponsor reservation at ${index}`);
    const record = value;
    const keys = ["requestId", "transactionBytes", "sponsor", "gasPrice", "gasBudget", "gasPayment", "expirationEpoch", "expiresAt", "sender", "projectId", "result"];
    if (Object.keys(record).some((key) => !keys.includes(key)))
        throw new BatonError("INVALID_STATE", `unknown sponsor reservation field at ${index}`);
    for (const key of keys.filter((key) => key !== "result" && key !== "gasPayment")) {
        if (typeof record[key] !== "string" || record[key].length === 0)
            throw new BatonError("INVALID_STATE", `invalid sponsor reservation ${key} at ${index}`);
    }
    if (!Array.isArray(record.gasPayment) || record.gasPayment.length !== 1)
        throw new BatonError("INVALID_STATE", `invalid sponsor gas payment at ${index}`);
    const gasPayment = record.gasPayment.map((payment) => {
        if (!payment || typeof payment !== "object" || Array.isArray(payment))
            throw new BatonError("INVALID_STATE", `invalid sponsor gas payment at ${index}`);
        const raw = payment;
        if (Object.keys(raw).some((key) => !["objectId", "version", "digest"].includes(key)))
            throw new BatonError("INVALID_STATE", `unknown sponsor gas payment field at ${index}`);
        if (typeof raw.objectId !== "string" || typeof raw.version !== "string" || typeof raw.digest !== "string")
            throw new BatonError("INVALID_STATE", `invalid sponsor gas payment at ${index}`);
        return { objectId: raw.objectId, version: raw.version, digest: raw.digest };
    });
    let result = null;
    if (record.result !== null) {
        if (!record.result || typeof record.result !== "object" || Array.isArray(record.result))
            throw new BatonError("INVALID_STATE", `invalid sponsor result at ${index}`);
        const raw = record.result;
        if (Object.keys(raw).some((key) => !["digest", "projectObjectId", "ownerCapId"].includes(key)))
            throw new BatonError("INVALID_STATE", `unknown sponsor result field at ${index}`);
        if (typeof raw.digest !== "string" || typeof raw.projectObjectId !== "string" || typeof raw.ownerCapId !== "string")
            throw new BatonError("INVALID_STATE", `invalid sponsor result at ${index}`);
        result = { digest: raw.digest, projectObjectId: raw.projectObjectId, ownerCapId: raw.ownerCapId };
    }
    return { ...record, gasPayment, result };
}
function parseState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new BatonError("INVALID_STATE", "sponsor state must be an object");
    const record = value;
    if (record.schemaVersion !== 1 || !Array.isArray(record.invites))
        throw new BatonError("INVALID_STATE", "unsupported sponsor state");
    const invites = record.invites.map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
            throw new BatonError("INVALID_STATE", `invalid sponsor invite ${index}`);
        const invite = entry;
        const allowed = ["id", "tokenHash", "createdAt", "expiresAt", "recipient", "projectId", "revokedAt", "usedAt", "reservation"];
        if (Object.keys(invite).some((key) => !allowed.includes(key)))
            throw new BatonError("INVALID_STATE", `unknown sponsor invite field at ${index}`);
        if (typeof invite.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(invite.tokenHash))
            throw new BatonError("INVALID_STATE", `invalid sponsor token hash at ${index}`);
        const id = invite.id === undefined ? `legacy-${invite.tokenHash.slice(0, 12)}` : invite.id;
        if (typeof id !== "string" || !/^(?:[0-9a-f-]{36}|legacy-[a-f0-9]{12})$/.test(id))
            throw new BatonError("INVALID_STATE", `invalid sponsor invite id at ${index}`);
        if (typeof invite.createdAt !== "string" || !Number.isFinite(Date.parse(invite.createdAt)))
            throw new BatonError("INVALID_STATE", `invalid sponsor createdAt at ${index}`);
        if (typeof invite.expiresAt !== "string" || !Number.isFinite(Date.parse(invite.expiresAt)))
            throw new BatonError("INVALID_STATE", `invalid sponsor expiresAt at ${index}`);
        const recipient = invite.recipient === undefined ? null : invite.recipient;
        const boundProject = invite.projectId === undefined ? null : invite.projectId;
        const revokedAt = invite.revokedAt === undefined ? null : invite.revokedAt;
        if (recipient !== null && typeof recipient !== "string")
            throw new BatonError("INVALID_STATE", `invalid sponsor recipient at ${index}`);
        if (boundProject !== null && typeof boundProject !== "string")
            throw new BatonError("INVALID_STATE", `invalid sponsor projectId at ${index}`);
        if (revokedAt !== null && (typeof revokedAt !== "string" || !Number.isFinite(Date.parse(revokedAt))))
            throw new BatonError("INVALID_STATE", `invalid sponsor revokedAt at ${index}`);
        if (invite.usedAt !== null && (typeof invite.usedAt !== "string" || !Number.isFinite(Date.parse(invite.usedAt))))
            throw new BatonError("INVALID_STATE", `invalid sponsor usedAt at ${index}`);
        return {
            ...invite,
            id,
            recipient: recipient === null ? null : normalizeSuiAddress(recipient),
            projectId: boundProject === null ? null : projectId(boundProject),
            revokedAt,
            reservation: parseReservation(invite.reservation, index),
        };
    });
    return { schemaVersion: 1, invites };
}
function readState(path) {
    if (!existsSync(path))
        return { schemaVersion: 1, invites: [] };
    if (lstatSync(path).isSymbolicLink())
        throw new BatonError("INVALID_STATE", `refusing symlinked sponsor state: ${path}`);
    try {
        return parseState(JSON.parse(readFileSync(path, "utf8")));
    }
    catch (err) {
        if (err instanceof BatonError)
            throw err;
        throw new BatonError("INVALID_STATE", `failed reading sponsor state ${path}`, { cause: err });
    }
}
function writeState(path, state) {
    const dir = dirname(path);
    const directoryExisted = existsSync(dir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!directoryExisted)
        chmodSync(dir, 0o700);
    const temp = join(dir, `.sponsor-${randomUUID()}.tmp`);
    try {
        writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        renameSync(temp, path);
        chmodSync(path, 0o600);
    }
    catch (err) {
        throw new BatonError("IO_ERROR", `failed writing sponsor state ${path}`, { cause: err });
    }
}
function activeInvite(path, token, now) {
    const state = readState(path);
    const invite = state.invites.find((entry) => entry.tokenHash === hashToken(token));
    if (!invite)
        throw new BatonError("NOT_FOUND", "sponsor invitation is unknown");
    if (invite.revokedAt)
        throw new BatonError("INVALID_STATE", "sponsor invitation has been revoked");
    if (invite.usedAt)
        return { state, invite };
    if (Date.parse(invite.expiresAt) <= now.getTime())
        throw new BatonError("INVALID_STATE", "sponsor invitation has expired");
    return { state, invite };
}
export function issueSponsorInviteDetails(path = defaultSponsorStatePath(), now = new Date(), ttlHours = 24, constraints = {}) {
    if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 168) {
        throw new BatonError("INVALID_STATE", "sponsor invitation lifetime must be 1–168 hours");
    }
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const state = readState(path);
    state.invites.push({
        id,
        tokenHash: hashToken(token),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString(),
        recipient: constraints.recipient === undefined ? null : normalizeSuiAddress(constraints.recipient),
        projectId: constraints.projectId === undefined ? null : projectId(constraints.projectId),
        revokedAt: null,
        usedAt: null,
        reservation: null,
    });
    writeState(path, state);
    return { id, token };
}
export function issueSponsorInvite(path = defaultSponsorStatePath(), now = new Date(), ttlHours = 24) {
    return issueSponsorInviteDetails(path, now, ttlHours).token;
}
function assertInviteConstraints(invite, sender, requestedProject) {
    if (invite.recipient && invite.recipient !== normalizeSuiAddress(sender)) {
        throw new BatonError("INVALID_STATE", "sponsor invitation is bound to another recipient");
    }
    if (invite.projectId && invite.projectId !== requestedProject) {
        throw new BatonError("INVALID_STATE", "sponsor invitation is bound to another project");
    }
}
export function existingSponsorReservation(input) {
    const { invite } = activeInvite(input.path, input.token, input.now ?? new Date());
    assertInviteConstraints(invite, input.sender, input.projectId);
    const reservation = invite.reservation;
    if (!reservation)
        return null;
    if (reservation.sender !== input.sender || reservation.projectId !== input.projectId) {
        throw new BatonError("INVALID_STATE", "sponsor invitation is reserved for another registration");
    }
    if (invite.usedAt && reservation.result)
        return reservation;
    if (Date.parse(reservation.expiresAt) <= (input.now ?? new Date()).getTime())
        return null;
    return reservation;
}
export function saveSponsorReservation(path, token, reservation, now = new Date()) {
    const { state, invite } = activeInvite(path, token, now);
    assertInviteConstraints(invite, reservation.sender, reservation.projectId);
    if (invite.usedAt)
        throw new BatonError("INVALID_STATE", "sponsor invitation has already been used");
    invite.reservation = reservation;
    writeState(path, state);
}
export function loadSponsorReservation(path, token, requestId, now = new Date()) {
    const { invite } = activeInvite(path, token, now);
    const reservation = invite.reservation;
    if (!reservation || reservation.requestId !== requestId)
        throw new BatonError("NOT_FOUND", "sponsored registration request is unknown");
    if (!reservation.result && Date.parse(reservation.expiresAt) <= now.getTime())
        throw new BatonError("INVALID_STATE", "sponsored registration request has expired");
    return reservation;
}
export function completeSponsorReservation(path, token, requestId, result, now = new Date()) {
    const { state, invite } = activeInvite(path, token, now);
    if (!invite.reservation || invite.reservation.requestId !== requestId)
        throw new BatonError("NOT_FOUND", "sponsored registration request is unknown");
    invite.reservation.result = result;
    invite.usedAt = now.toISOString();
    writeState(path, state);
}
export function reservedSponsorGasObjects(path, now = new Date()) {
    const state = readState(path);
    const reserved = new Set();
    for (const invite of state.invites) {
        const reservation = invite.reservation;
        if (!reservation || reservation.result || Date.parse(reservation.expiresAt) <= now.getTime())
            continue;
        for (const payment of reservation.gasPayment)
            reserved.add(payment.objectId.toLowerCase());
    }
    return reserved;
}
export function listSponsorInvites(path = defaultSponsorStatePath(), now = new Date()) {
    return readState(path).invites.map((invite) => ({
        id: invite.id,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        recipient: invite.recipient,
        projectId: invite.projectId,
        status: invite.revokedAt
            ? "revoked"
            : invite.usedAt
                ? "used"
                : Date.parse(invite.expiresAt) <= now.getTime()
                    ? "expired"
                    : invite.reservation
                        ? "reserved"
                        : "available",
        requestId: invite.reservation?.requestId ?? null,
        digest: invite.reservation?.result?.digest ?? null,
    }));
}
export function sponsorUsageSnapshot(path = defaultSponsorStatePath(), now = new Date()) {
    const state = readState(path);
    const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    let completedToday = 0;
    let activeReservations = 0;
    for (const invite of state.invites) {
        if (invite.usedAt && Date.parse(invite.usedAt) >= startOfDay)
            completedToday += 1;
        const reservation = invite.reservation;
        if (!invite.revokedAt && !invite.usedAt && reservation && !reservation.result && Date.parse(reservation.expiresAt) > now.getTime()) {
            activeReservations += 1;
        }
    }
    return { completedToday, activeReservations };
}
export function revokeSponsorInvite(path, id, now = new Date()) {
    const state = readState(path);
    const invite = state.invites.find((entry) => entry.id === id);
    if (!invite)
        throw new BatonError("NOT_FOUND", `sponsor invitation ${id} is unknown`);
    if (invite.usedAt)
        throw new BatonError("INVALID_STATE", "a used sponsor invitation cannot be revoked");
    if (!invite.revokedAt) {
        invite.revokedAt = now.toISOString();
        writeState(path, state);
    }
}
export function pruneSponsorInvites(path = defaultSponsorStatePath(), now = new Date()) {
    const state = readState(path);
    const before = state.invites.length;
    state.invites = state.invites.filter((invite) => invite.usedAt !== null || (invite.revokedAt === null && Date.parse(invite.expiresAt) > now.getTime()));
    const removed = before - state.invites.length;
    if (removed > 0)
        writeState(path, state);
    return removed;
}
//# sourceMappingURL=state.js.map