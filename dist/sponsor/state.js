import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { BatonError } from "../core/errors.js";
export function defaultSponsorStatePath(home = homedir()) {
    return join(home, ".baton", "sponsor.json");
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
        const allowed = ["tokenHash", "createdAt", "expiresAt", "usedAt", "reservation"];
        if (Object.keys(invite).some((key) => !allowed.includes(key)))
            throw new BatonError("INVALID_STATE", `unknown sponsor invite field at ${index}`);
        if (typeof invite.tokenHash !== "string" || !/^[a-f0-9]{64}$/.test(invite.tokenHash))
            throw new BatonError("INVALID_STATE", `invalid sponsor token hash at ${index}`);
        if (typeof invite.createdAt !== "string" || !Number.isFinite(Date.parse(invite.createdAt)))
            throw new BatonError("INVALID_STATE", `invalid sponsor createdAt at ${index}`);
        if (typeof invite.expiresAt !== "string" || !Number.isFinite(Date.parse(invite.expiresAt)))
            throw new BatonError("INVALID_STATE", `invalid sponsor expiresAt at ${index}`);
        if (invite.usedAt !== null && (typeof invite.usedAt !== "string" || !Number.isFinite(Date.parse(invite.usedAt))))
            throw new BatonError("INVALID_STATE", `invalid sponsor usedAt at ${index}`);
        return { ...invite, reservation: parseReservation(invite.reservation, index) };
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
    if (invite.usedAt)
        return { state, invite };
    if (Date.parse(invite.expiresAt) <= now.getTime())
        throw new BatonError("INVALID_STATE", "sponsor invitation has expired");
    return { state, invite };
}
export function issueSponsorInvite(path = defaultSponsorStatePath(), now = new Date(), ttlHours = 24) {
    if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 168) {
        throw new BatonError("INVALID_STATE", "sponsor invitation lifetime must be 1–168 hours");
    }
    const token = randomBytes(32).toString("base64url");
    const state = readState(path);
    state.invites.push({
        tokenHash: hashToken(token),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString(),
        usedAt: null,
        reservation: null,
    });
    writeState(path, state);
    return token;
}
export function existingSponsorReservation(input) {
    const { invite } = activeInvite(input.path, input.token, input.now ?? new Date());
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
//# sourceMappingURL=state.js.map