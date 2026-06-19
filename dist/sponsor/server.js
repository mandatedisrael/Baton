import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { fromBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import { isValidTransactionSignature } from "@mysten/sui/verify";
import { BatonError } from "../core/errors.js";
import { buildSponsoredRegistrationBytes, executeSponsoredRegistrationWithSignature, serializeSponsoredTransaction, SPONSORED_REGISTRATION_GAS_BUDGET, } from "../chain/sponsorship.js";
import { completeSponsorReservation, existingSponsorReservation, loadSponsorReservation, saveSponsorReservation, } from "./state.js";
const MAX_BODY_BYTES = 16 * 1024;
const REQUEST_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 30;
function json(response, status, value) {
    const body = `${JSON.stringify(value)}\n`;
    response.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
    });
    response.end(body);
}
async function body(request) {
    if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
        throw new BatonError("INVALID_STATE", "content-type must be application/json");
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += value.length;
        if (bytes > MAX_BODY_BYTES)
            throw new BatonError("INVALID_STATE", "request body exceeds 16 KiB");
        chunks.push(value);
    }
    let value;
    try {
        value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch (err) {
        throw new BatonError("INVALID_STATE", "request body is not valid JSON", { cause: err });
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new BatonError("INVALID_STATE", "request body must be an object");
    return value;
}
function strictStrings(value, keys) {
    if (Object.keys(value).some((key) => !keys.includes(key)))
        throw new BatonError("INVALID_STATE", "request contains unknown fields");
    const result = {};
    for (const key of keys) {
        if (typeof value[key] !== "string" || value[key].length === 0)
            throw new BatonError("INVALID_STATE", `request.${key} must be a non-empty string`);
        result[key] = value[key];
    }
    return result;
}
function publicEnvelope(reservation) {
    return {
        requestId: reservation.requestId,
        transactionBytes: reservation.transactionBytes,
        sponsor: reservation.sponsor,
        gasPrice: reservation.gasPrice,
        gasBudget: reservation.gasBudget,
        expirationEpoch: reservation.expirationEpoch,
        expiresAt: reservation.expiresAt,
    };
}
export function createSponsorServer(options) {
    const inFlight = new Set();
    const rates = new Map();
    const now = options.now ?? (() => new Date());
    const server = createServer(async (request, response) => {
        const ip = request.socket.remoteAddress ?? "unknown";
        const time = now().getTime();
        const rate = rates.get(ip);
        if (!rate || time - rate.startedAt >= RATE_WINDOW_MS)
            rates.set(ip, { startedAt: time, count: 1 });
        else if (++rate.count > RATE_LIMIT) {
            json(response, 429, { error: "rate limit exceeded" });
            return;
        }
        try {
            if (request.method === "GET" && request.url === "/health") {
                json(response, 200, { ok: true, network: "testnet", sponsor: options.sponsorKeypair.toSuiAddress() });
                return;
            }
            if (request.method === "POST" && request.url === "/v1/register/prepare") {
                const input = strictStrings(await body(request), ["token", "sender", "projectId"]);
                const sender = normalizeSuiAddress(input.sender);
                const projectId = input.projectId;
                const existing = existingSponsorReservation({
                    path: options.statePath,
                    token: input.token,
                    sender,
                    projectId,
                    now: now(),
                });
                if (existing) {
                    json(response, 200, publicEnvelope(existing));
                    return;
                }
                const system = await options.client.getLatestSuiSystemState();
                const gasPrice = await options.client.getReferenceGasPrice();
                const expirationEpoch = BigInt(system.epoch) + 1n;
                const requestNow = now();
                const expiresAt = new Date(requestNow.getTime() + REQUEST_TTL_MS).toISOString();
                const transactionBytes = await buildSponsoredRegistrationBytes({
                    packageId: options.policyPackageId,
                    projectId,
                    sender,
                    sponsor: options.sponsorKeypair.toSuiAddress(),
                    gasPrice,
                    expirationEpoch,
                });
                const reservation = {
                    requestId: randomUUID(),
                    transactionBytes: serializeSponsoredTransaction(transactionBytes),
                    sponsor: options.sponsorKeypair.toSuiAddress(),
                    gasPrice: gasPrice.toString(),
                    gasBudget: SPONSORED_REGISTRATION_GAS_BUDGET.toString(),
                    expirationEpoch: expirationEpoch.toString(),
                    expiresAt,
                    sender,
                    projectId,
                    result: null,
                };
                saveSponsorReservation(options.statePath, input.token, reservation, requestNow);
                json(response, 200, publicEnvelope(reservation));
                return;
            }
            if (request.method === "POST" && request.url === "/v1/register/execute") {
                const input = strictStrings(await body(request), ["token", "requestId", "userSignature"]);
                const reservation = loadSponsorReservation(options.statePath, input.token, input.requestId, now());
                if (reservation.result) {
                    json(response, 200, reservation.result);
                    return;
                }
                if (inFlight.has(reservation.requestId))
                    throw new BatonError("INVALID_STATE", "sponsored registration is already executing");
                const transactionBytes = fromBase64(reservation.transactionBytes);
                const valid = await isValidTransactionSignature(transactionBytes, input.userSignature, {
                    client: options.client,
                    address: reservation.sender,
                });
                if (!valid)
                    throw new BatonError("INVALID_STATE", "user signature does not authorize the sponsored registration");
                inFlight.add(reservation.requestId);
                try {
                    const result = await executeSponsoredRegistrationWithSignature({
                        client: options.client,
                        sponsorKeypair: options.sponsorKeypair,
                        transactionBytes,
                        userSignature: input.userSignature,
                        typePackageId: options.typePackageId,
                    });
                    completeSponsorReservation(options.statePath, input.token, reservation.requestId, result, now());
                    json(response, 200, result);
                }
                finally {
                    inFlight.delete(reservation.requestId);
                }
                return;
            }
            json(response, 404, { error: "not found" });
        }
        catch (err) {
            const status = err instanceof BatonError && err.code === "NOT_FOUND" ? 404 : 400;
            json(response, status, { error: err instanceof Error ? err.message : "request failed" });
        }
    });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    return server;
}
//# sourceMappingURL=server.js.map