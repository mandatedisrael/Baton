import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { fromBase64, normalizeSuiAddress } from "@mysten/sui/utils";
import { isValidTransactionSignature } from "@mysten/sui/verify";
import { BatonError } from "../core/errors.ts";
import {
  buildSponsoredRegistrationBytes,
  executeSponsoredRegistrationWithSignature,
  serializeSponsoredTransaction,
  SPONSORED_REGISTRATION_GAS_BUDGET,
  type SponsoredRegistrationEnvelope,
} from "../chain/sponsorship.ts";
import {
  completeSponsorReservation,
  existingSponsorReservation,
  loadSponsorReservation,
  saveSponsorReservation,
  sponsorUsageSnapshot,
  reservedSponsorGasObjects,
  type SponsorReservation,
  withSponsorStateLock,
} from "./state.ts";

const MAX_BODY_BYTES = 16 * 1024;
const REQUEST_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 30;
const MAX_DAILY_REGISTRATIONS = 100;
const MAX_ACTIVE_RESERVATIONS = 10;

interface SponsorMetrics {
  prepared: number;
  completed: number;
  rejected: number;
  rateLimited: number;
  readinessFailures: number;
}

export interface SponsorServerOptions {
  client: SuiJsonRpcClient;
  sponsorKeypair: Ed25519Keypair;
  statePath: string;
  policyPackageId: string;
  typePackageId: string;
  now?: () => Date;
  trustProxy?: boolean;
  rateLimitPerMinute?: number;
  maxDailyRegistrations?: number;
  maxActiveReservations?: number;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function metrics(
  response: ServerResponse,
  values: SponsorMetrics,
  usage: { completedToday: number; activeReservations: number },
  limits: { daily: number; active: number },
): void {
  const body = [
    "# HELP baton_sponsor_prepared_total Successful registration prepare responses.",
    "# TYPE baton_sponsor_prepared_total counter",
    `baton_sponsor_prepared_total ${values.prepared}`,
    "# HELP baton_sponsor_completed_total Successful registration execute responses, including idempotent retries.",
    "# TYPE baton_sponsor_completed_total counter",
    `baton_sponsor_completed_total ${values.completed}`,
    "# HELP baton_sponsor_rejected_total Registration requests rejected after validation.",
    "# TYPE baton_sponsor_rejected_total counter",
    `baton_sponsor_rejected_total ${values.rejected}`,
    "# HELP baton_sponsor_rate_limited_total Registration requests refused by client rate limits.",
    "# TYPE baton_sponsor_rate_limited_total counter",
    `baton_sponsor_rate_limited_total ${values.rateLimited}`,
    "# HELP baton_sponsor_readiness_failures_total Readiness checks that could not prove spend capacity.",
    "# TYPE baton_sponsor_readiness_failures_total counter",
    `baton_sponsor_readiness_failures_total ${values.readinessFailures}`,
    "# HELP baton_sponsor_completed_today Completed registrations since 00:00 UTC.",
    "# TYPE baton_sponsor_completed_today gauge",
    `baton_sponsor_completed_today ${usage.completedToday}`,
    "# HELP baton_sponsor_active_reservations Registration transactions awaiting execution.",
    "# TYPE baton_sponsor_active_reservations gauge",
    `baton_sponsor_active_reservations ${usage.activeReservations}`,
    "# HELP baton_sponsor_daily_limit Configured daily registration liability limit.",
    "# TYPE baton_sponsor_daily_limit gauge",
    `baton_sponsor_daily_limit ${limits.daily}`,
    "# HELP baton_sponsor_active_limit Configured concurrent reservation limit.",
    "# TYPE baton_sponsor_active_limit gauge",
    `baton_sponsor_active_limit ${limits.active}`,
    "",
  ].join("\n");
  response.writeHead(200, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function clientAddress(request: IncomingMessage, trustProxy: boolean): string {
  const peer = request.socket.remoteAddress ?? "unknown";
  if (!trustProxy) return peer;
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded !== "string") return peer;
  const candidate = forwarded.split(",").at(-1)?.trim() ?? "";
  return isIP(candidate) ? candidate : peer;
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
    throw new BatonError("INVALID_STATE", "content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.length;
    if (bytes > MAX_BODY_BYTES) throw new BatonError("INVALID_STATE", "request body exceeds 16 KiB");
    chunks.push(value);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (err) {
    throw new BatonError("INVALID_STATE", "request body is not valid JSON", { cause: err });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BatonError("INVALID_STATE", "request body must be an object");
  return value as Record<string, unknown>;
}

function strictStrings(value: Record<string, unknown>, keys: string[]): Record<string, string> {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new BatonError("INVALID_STATE", "request contains unknown fields");
  const result: Record<string, string> = {};
  for (const key of keys) {
    if (typeof value[key] !== "string" || value[key].length === 0) throw new BatonError("INVALID_STATE", `request.${key} must be a non-empty string`);
    result[key] = value[key];
  }
  return result;
}

function publicEnvelope(reservation: SponsorReservation): SponsoredRegistrationEnvelope {
  return {
    requestId: reservation.requestId,
    transactionBytes: reservation.transactionBytes,
    sponsor: reservation.sponsor,
    gasPrice: reservation.gasPrice,
    gasBudget: reservation.gasBudget,
    gasPayment: reservation.gasPayment,
    expirationEpoch: reservation.expirationEpoch,
    expiresAt: reservation.expiresAt,
  };
}

async function availableSponsorGasPayment(
  client: SuiJsonRpcClient,
  owner: string,
  reserved: Set<string>,
): Promise<Array<{ objectId: string; version: string; digest: string }>> {
  let cursor: string | null | undefined;
  do {
    const coins = await client.getCoins({ owner, coinType: "0x2::sui::SUI", cursor, limit: 50 });
    const coin = coins.data.find((candidate) =>
      BigInt(candidate.balance) >= SPONSORED_REGISTRATION_GAS_BUDGET &&
      !reserved.has(candidate.coinObjectId.toLowerCase()),
    );
    if (coin) return [{ objectId: coin.coinObjectId, version: coin.version, digest: coin.digest }];
    cursor = coins.hasNextPage ? coins.nextCursor : null;
  } while (cursor);
  return [];
}

export function createSponsorServer(options: SponsorServerOptions): Server {
  const inFlight = new Set<string>();
  const rates = new Map<string, { startedAt: number; count: number }>();
  const now = options.now ?? (() => new Date());
  const rateLimit = options.rateLimitPerMinute ?? RATE_LIMIT;
  const maxDailyRegistrations = options.maxDailyRegistrations ?? MAX_DAILY_REGISTRATIONS;
  const maxActiveReservations = options.maxActiveReservations ?? MAX_ACTIVE_RESERVATIONS;
  for (const [name, value] of Object.entries({ rateLimit, maxDailyRegistrations, maxActiveReservations })) {
    if (!Number.isInteger(value) || value < 1) throw new BatonError("INVALID_STATE", `${name} must be a positive integer`);
  }
  const counters: SponsorMetrics = { prepared: 0, completed: 0, rejected: 0, rateLimited: 0, readinessFailures: 0 };

  const server = createServer(async (request, response) => {
    const isRegistration = request.method === "POST" &&
      (request.url === "/v1/register/prepare" || request.url === "/v1/register/execute");
    if (isRegistration) {
      const ip = clientAddress(request, options.trustProxy ?? false);
      const time = now().getTime();
      if (rates.size > 10_000) {
        for (const [address, entry] of rates) if (time - entry.startedAt >= RATE_WINDOW_MS) rates.delete(address);
      }
      const rate = rates.get(ip);
      if (!rate || time - rate.startedAt >= RATE_WINDOW_MS) rates.set(ip, { startedAt: time, count: 1 });
      else if (++rate.count > rateLimit) {
        counters.rateLimited += 1;
        json(response, 429, { error: "rate limit exceeded" });
        return;
      }
    }

    try {
      if (request.method === "GET" && request.url === "/health") {
        json(response, 200, { ok: true, network: "testnet", sponsor: options.sponsorKeypair.toSuiAddress() });
        return;
      }
      if (request.method === "GET" && request.url === "/metrics") {
        const usage = await withSponsorStateLock(options.statePath, () => sponsorUsageSnapshot(options.statePath, now()));
        metrics(response, counters, usage, { daily: maxDailyRegistrations, active: maxActiveReservations });
        return;
      }
      if (request.method === "GET" && request.url === "/ready") {
        try {
          await options.client.getLatestSuiSystemState();
          const available = await withSponsorStateLock(options.statePath, async () => {
            const reserved = reservedSponsorGasObjects(options.statePath, now());
            return (await availableSponsorGasPayment(
              options.client,
              options.sponsorKeypair.toSuiAddress(),
              reserved,
            )).length > 0;
          });
          if (!available) throw new BatonError("INVALID_STATE", "no unreserved sponsor gas coin is ready");
          json(response, 200, { ok: true, network: "testnet", sponsor: options.sponsorKeypair.toSuiAddress() });
        } catch (err) {
          counters.readinessFailures += 1;
          json(response, 503, { ok: false, error: err instanceof Error ? err.message : "readiness check failed" });
        }
        return;
      }
      if (request.method === "POST" && request.url === "/v1/register/prepare") {
        const input = strictStrings(await body(request), ["token", "sender", "projectId"]);
        const sender = normalizeSuiAddress(input.sender!);
        const projectId = input.projectId!;
        const envelope = await withSponsorStateLock(options.statePath, async () => {
          const existing = existingSponsorReservation({
            path: options.statePath,
            token: input.token!,
            sender,
            projectId,
            now: now(),
          });
          if (existing) return publicEnvelope(existing);
          const usage = sponsorUsageSnapshot(options.statePath, now());
          if (usage.completedToday + usage.activeReservations >= maxDailyRegistrations) {
            throw new BatonError("INVALID_STATE", "sponsor daily registration limit reached");
          }
          if (usage.activeReservations >= maxActiveReservations) {
            throw new BatonError("INVALID_STATE", "sponsor active reservation limit reached");
          }
          const system = await options.client.getLatestSuiSystemState();
          const gasPrice = await options.client.getReferenceGasPrice();
          const reservedGas = reservedSponsorGasObjects(options.statePath, now());
          const gasPayment = await availableSponsorGasPayment(
            options.client,
            options.sponsorKeypair.toSuiAddress(),
            reservedGas,
          );
          if (gasPayment.length === 0) throw new BatonError("INVALID_STATE", "sponsor has no unreserved SUI coin large enough for registration");
          const expirationEpoch = BigInt(system.epoch) + 1n;
          const requestNow = now();
          const expiresAt = new Date(requestNow.getTime() + REQUEST_TTL_MS).toISOString();
          const transactionBytes = await buildSponsoredRegistrationBytes({
            packageId: options.policyPackageId,
            projectId,
            sender,
            sponsor: options.sponsorKeypair.toSuiAddress(),
            gasPrice,
            gasPayment,
            expirationEpoch,
          });
          const reservation: SponsorReservation = {
            requestId: randomUUID(),
            transactionBytes: serializeSponsoredTransaction(transactionBytes),
            sponsor: options.sponsorKeypair.toSuiAddress(),
            gasPrice: gasPrice.toString(),
            gasBudget: SPONSORED_REGISTRATION_GAS_BUDGET.toString(),
            gasPayment,
            expirationEpoch: expirationEpoch.toString(),
            expiresAt,
            sender,
            projectId,
            result: null,
          };
          saveSponsorReservation(options.statePath, input.token!, reservation, requestNow);
          return publicEnvelope(reservation);
        });
        counters.prepared += 1;
        json(response, 200, envelope);
        return;
      }
      if (request.method === "POST" && request.url === "/v1/register/execute") {
        const input = strictStrings(await body(request), ["token", "requestId", "userSignature"]);
        const result = await withSponsorStateLock(options.statePath, async () => {
          const reservation = loadSponsorReservation(options.statePath, input.token!, input.requestId!, now());
          if (reservation.result) return reservation.result;
          if (inFlight.has(reservation.requestId)) throw new BatonError("INVALID_STATE", "sponsored registration is already executing");
          const transactionBytes = fromBase64(reservation.transactionBytes);
          const valid = await isValidTransactionSignature(transactionBytes, input.userSignature!, {
            client: options.client,
            address: reservation.sender,
          });
          if (!valid) throw new BatonError("INVALID_STATE", "user signature does not authorize the sponsored registration");
          inFlight.add(reservation.requestId);
          try {
            const executed = await executeSponsoredRegistrationWithSignature({
              client: options.client,
              sponsorKeypair: options.sponsorKeypair,
              transactionBytes,
              userSignature: input.userSignature!,
              typePackageId: options.typePackageId,
            });
            completeSponsorReservation(options.statePath, input.token!, reservation.requestId, executed, now());
            return executed;
          } finally {
            inFlight.delete(reservation.requestId);
          }
        }, 90_000);
        counters.completed += 1;
        json(response, 200, result);
        return;
      }
      json(response, 404, { error: "not found" });
    } catch (err) {
      if (isRegistration) counters.rejected += 1;
      const status = err instanceof BatonError && err.code === "NOT_FOUND"
        ? 404
        : err instanceof BatonError && err.message.includes("limit reached")
          ? 429
          : 400;
      json(response, status, { error: err instanceof Error ? err.message : "request failed" });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
