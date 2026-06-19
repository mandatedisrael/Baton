import { arr, isoDatetime, literal, nullable, num, obj, oneOf, optStr, str, ValidationError } from "./validate.ts";

export const SUI_NETWORKS = ["testnet", "mainnet"] as const;
export type SuiNetwork = (typeof SUI_NETWORKS)[number];

export interface PublicKeyServerConfig {
  objectId: string;
  weight: number;
  aggregatorUrl?: string;
}

export interface RemoteProjectConfig {
  network: SuiNetwork;
  rpcUrl: string;
  packageId: string;
  projectObjectId: string;
  ownerCapId: string;
  registrationTx: string;
  registeredAt: string;
  seal: {
    threshold: number;
    serverConfigs: PublicKeyServerConfig[];
  };
}

export interface ProjectConfig {
  schemaVersion: 1;
  projectId: string;
  createdAt: string;
  head: string | null;
  remote: RemoteProjectConfig | null;
}

function suiId(v: unknown, path: string): string {
  const value = str(v, path);
  if (!/^0x[a-fA-F0-9]{1,64}$/.test(value)) throw new ValidationError(path, "expected a Sui object id");
  return value.toLowerCase();
}

function httpUrl(v: unknown, path: string): string {
  const value = str(v, path, { min: 1 });
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError(path, "expected a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ValidationError(path, "expected an http or https URL");
  }
  return value;
}

function parseKeyServer(v: unknown, path: string): PublicKeyServerConfig {
  const r = obj(v, path, ["objectId", "weight", "aggregatorUrl"]);
  const result: PublicKeyServerConfig = {
    objectId: suiId(r.objectId, `${path}.objectId`),
    weight: num(r.weight, `${path}.weight`, { int: true, min: 1 }),
  };
  const aggregatorUrl = optStr(r.aggregatorUrl, `${path}.aggregatorUrl`, { min: 1 });
  if (aggregatorUrl !== undefined) result.aggregatorUrl = httpUrl(aggregatorUrl, `${path}.aggregatorUrl`);
  return result;
}

function parseRemote(v: unknown, path: string): RemoteProjectConfig {
  const r = obj(v, path, [
    "network",
    "rpcUrl",
    "packageId",
    "projectObjectId",
    "ownerCapId",
    "registrationTx",
    "registeredAt",
    "seal",
  ]);
  const sealRaw = obj(r.seal, `${path}.seal`, ["threshold", "serverConfigs"]);
  const serverConfigs = arr(sealRaw.serverConfigs, `${path}.seal.serverConfigs`, parseKeyServer);
  if (serverConfigs.length === 0) throw new ValidationError(`${path}.seal.serverConfigs`, "expected at least one server");
  const threshold = num(sealRaw.threshold, `${path}.seal.threshold`, { int: true, min: 1 });
  const totalWeight = serverConfigs.reduce((sum, server) => sum + server.weight, 0);
  if (threshold > totalWeight) {
    throw new ValidationError(`${path}.seal.threshold`, `cannot exceed total server weight ${totalWeight}`);
  }
  return {
    network: oneOf(r.network, `${path}.network`, SUI_NETWORKS),
    rpcUrl: httpUrl(r.rpcUrl, `${path}.rpcUrl`),
    packageId: suiId(r.packageId, `${path}.packageId`),
    projectObjectId: suiId(r.projectObjectId, `${path}.projectObjectId`),
    ownerCapId: suiId(r.ownerCapId, `${path}.ownerCapId`),
    registrationTx: str(r.registrationTx, `${path}.registrationTx`, { min: 1 }),
    registeredAt: isoDatetime(r.registeredAt, `${path}.registeredAt`),
    seal: { threshold, serverConfigs },
  };
}

export function parseProjectConfig(v: unknown): ProjectConfig {
  const r = obj(v, "config", ["schemaVersion", "projectId", "createdAt", "head", "remote"]);
  return {
    schemaVersion: literal(r.schemaVersion, "config.schemaVersion", 1),
    projectId: str(r.projectId, "config.projectId", { min: 1 }),
    createdAt: isoDatetime(r.createdAt, "config.createdAt"),
    head: nullable(r.head, "config.head", (value, path) => str(value, path, { min: 1 })),
    // Existing phase-1 configs predate this field; absence migrates safely to local-only.
    remote: nullable(r.remote ?? null, "config.remote", parseRemote),
  };
}
