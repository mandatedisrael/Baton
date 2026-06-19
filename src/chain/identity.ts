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
import { isoDatetime, literal, obj, str } from "../schema/validate.ts";

export interface LocalIdentity {
  schemaVersion: 1;
  scheme: "ED25519";
  address: string;
  secretKey: string;
  createdAt: string;
}

export interface LoadedIdentity {
  record: LocalIdentity;
  keypair: Ed25519Keypair;
}

export function defaultIdentityPath(home: string = homedir()): string {
  return join(home, ".baton", "identity.json");
}

function parseIdentity(value: unknown): LocalIdentity {
  const r = obj(value, "identity", ["schemaVersion", "scheme", "address", "secretKey", "createdAt"]);
  return {
    schemaVersion: literal(r.schemaVersion, "identity.schemaVersion", 1),
    scheme: literal(r.scheme, "identity.scheme", "ED25519"),
    address: str(r.address, "identity.address", { min: 1 }),
    secretKey: str(r.secretKey, "identity.secretKey", { min: 1 }),
    createdAt: isoDatetime(r.createdAt, "identity.createdAt"),
  };
}

export function loadIdentity(path: string = defaultIdentityPath()): LoadedIdentity {
  if (!existsSync(path)) throw new BatonError("NOT_FOUND", `no Baton identity at ${path} — run \`baton login\``);
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new BatonError("INVALID_STATE", `refusing symlinked identity file: ${path}`);
    }
    const record = parseIdentity(JSON.parse(readFileSync(path, "utf8")));
    const keypair = Ed25519Keypair.fromSecretKey(record.secretKey);
    const actualAddress = keypair.toSuiAddress();
    if (actualAddress !== record.address) {
      throw new BatonError("INVALID_STATE", "identity address does not match its private key");
    }
    chmodSync(path, 0o600);
    return { record, keypair };
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
  const record: LocalIdentity = {
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
