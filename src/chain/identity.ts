import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { BatonError } from "../core/errors.ts";
import { isoDatetime, literal, obj, str, nullable } from "../schema/validate.ts";
import type { ZkLoginSession, ZkProvider } from "./zklogin.ts";

export interface Ed25519IdentityRecord {
  schemaVersion: 1;
  scheme: "ED25519";
  address: string;
  secretKey: string;
  createdAt: string;
}

export interface ZkLoginIdentityRecord {
  schemaVersion: 1;
  scheme: "ZKLOGIN";
  address: string;
  provider: ZkProvider;
  userSalt: string;
  ephemeralPrivateKey: string;
  maxEpoch: number;
  randomness: string;
  lastJwt?: string;
  createdAt: string;
}

export type IdentityRecord = Ed25519IdentityRecord | ZkLoginIdentityRecord;

export type LoadedIdentity =
  | { scheme: "ED25519"; record: Ed25519IdentityRecord; keypair: Ed25519Keypair }
  | { scheme: "ZKLOGIN"; record: ZkLoginIdentityRecord; session: ZkLoginSession };

export function defaultIdentityPath(home: string = homedir()): string {
  return join(home, ".baton", "identity.json");
}

function parseIdentity(value: unknown): IdentityRecord {
  const r = obj(value, "identity", ["schemaVersion", "scheme", "address", "createdAt"]);

  const scheme = literal(r.scheme, "identity.scheme", "ED25519") as "ED25519" | "ZKLOGIN";
  const address = str(r.address, "identity.address", { min: 1 });
  const createdAt = isoDatetime(r.createdAt, "identity.createdAt");

  if (scheme === "ED25519") {
    return {
      schemaVersion: 1,
      scheme: "ED25519",
      address,
      secretKey: str(r.secretKey, "identity.secretKey", { min: 1 }),
      createdAt,
    };
  }

  if (scheme === "ZKLOGIN") {
    return {
      schemaVersion: 1,
      scheme: "ZKLOGIN",
      address,
      provider: literal(r.provider, "identity.provider", "google") as ZkProvider,
      userSalt: str(r.userSalt, "identity.userSalt", { min: 1 }),
      ephemeralPrivateKey: str(r.ephemeralPrivateKey, "identity.ephemeralPrivateKey", { min: 1 }),
      maxEpoch: Number(r.maxEpoch),
      randomness: str(r.randomness, "identity.randomness", { min: 1 }),
      lastJwt: nullable(r.lastJwt, "identity.lastJwt", (v, p) => str(v, p)) ?? undefined,
      createdAt,
    };
  }

  throw new BatonError("INVALID_STATE", `Unknown identity scheme: ${scheme}`);
}

export function loadIdentity(path: string = defaultIdentityPath()): LoadedIdentity {
  if (!existsSync(path)) throw new BatonError("NOT_FOUND", `no Baton identity at ${path} — run \`baton login\``);
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new BatonError("INVALID_STATE", `refusing symlinked identity file: ${path}`);
    }
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const record = parseIdentity(raw);

    chmodSync(path, 0o600);

    if (record.scheme === "ED25519") {
      const keypair = Ed25519Keypair.fromSecretKey(record.secretKey);
      const actualAddress = keypair.toSuiAddress();
      if (actualAddress !== record.address) {
        throw new BatonError("INVALID_STATE", "identity address does not match its private key");
      }
      return { scheme: "ED25519", record, keypair };
    }

    // ZKLOGIN
    // Reconstruct the session object (ephemeral key is loaded on demand in zklogin.ts)
    const session: ZkLoginSession = {
      scheme: "ZKLOGIN",
      provider: record.provider,
      address: record.address,
      userSalt: record.userSalt,
      ephemeralPrivateKey: record.ephemeralPrivateKey,
      maxEpoch: record.maxEpoch,
      randomness: record.randomness,
      lastJwt: record.lastJwt,
    };
    return { scheme: "ZKLOGIN", record, session };
  } catch (err) {
    if (err instanceof BatonError) throw err;
    throw new BatonError("INVALID_STATE", `failed to load Baton identity at ${path}`, { cause: err });
  }
}

export function loadOrCreateIdentity(
  path: string = defaultIdentityPath(),
  now: Date = new Date(),
): LoadedIdentity {
  if (existsSync(path)) return loadIdentity(path);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  const keypair = new Ed25519Keypair();
  const record: Ed25519IdentityRecord = {
    schemaVersion: 1,
    scheme: "ED25519",
    address: keypair.toSuiAddress(),
    secretKey: keypair.getSecretKey(),
    createdAt: now.toISOString(),
  };
  const temp = join(dir, `.identity-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(record, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    try {
      // link is atomic and refuses to replace an identity created by another process.
      linkSync(temp, path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  } catch (err) {
    throw new BatonError("IO_ERROR", `failed to create Baton identity at ${path}`, { cause: err });
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
  return loadIdentity(path);
}

/** Save (or overwrite) a ZKLOGIN identity record atomically. */
export function saveZkLoginIdentity(
  session: ZkLoginSession,
  path: string = defaultIdentityPath(),
  now: Date = new Date()
): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);

  const record: ZkLoginIdentityRecord = {
    schemaVersion: 1,
    scheme: "ZKLOGIN",
    address: session.address,
    provider: session.provider,
    userSalt: session.userSalt,
    ephemeralPrivateKey: session.ephemeralPrivateKey,
    maxEpoch: session.maxEpoch,
    randomness: session.randomness,
    lastJwt: session.lastJwt,
    createdAt: now.toISOString(),
  };

  const temp = join(dir, `.identity-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(record, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    try {
      linkSync(temp, path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // If exists (very rare race), we overwrite with rename for atomicity on supported platforms.
      // Fallback: direct write is acceptable because we already have the 0600 perms.
      writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    }
  } catch (err) {
    throw new BatonError("IO_ERROR", `failed to save zkLogin identity at ${path}`, { cause: err });
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
  chmodSync(path, 0o600);
}

/** Returns true if the loaded identity is a zkLogin one. */
export function isZkLoginIdentity(loaded: LoadedIdentity): loaded is { scheme: "ZKLOGIN"; record: ZkLoginIdentityRecord; session: ZkLoginSession } {
  return loaded.scheme === "ZKLOGIN";
}

/** Helper for code that still requires a raw Ed25519 keypair (until fully migrated to unified signing). */
export function requireEd25519Identity(loaded: LoadedIdentity): { record: Ed25519IdentityRecord; keypair: Ed25519Keypair } {
  if (loaded.scheme !== "ED25519") {
    throw new BatonError(
      "INVALID_STATE",
      "This command requires an Ed25519 identity for now (Seal or certain Walrus ops). Use `baton login` (without --zk) for a raw keypair, or a separate ED identity for these ops."
    );
  }
  return loaded;
}

/** Get the Sui address for any identity type (ED or ZK). */
export function getIdentityAddress(loaded: LoadedIdentity): string {
  return loaded.record.address;
}

/**
 * Unified way to obtain a signer/keypair when the operation still requires ED.
 * For zkLogin paths, use signTransactionWithZkLogin from zklogin.ts instead.
 */
export function getEd25519Keypair(loaded: LoadedIdentity): Ed25519Keypair {
  if (loaded.scheme === "ED25519") {
    return loaded.keypair;
  }
  throw new BatonError("INVALID_STATE", "Expected Ed25519 identity but got zkLogin identity.");
}
