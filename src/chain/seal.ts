import { SealClient, type KeyServerConfig } from "@mysten/seal";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { BatonError } from "../core/errors.ts";
import type { EncryptionRequest, PayloadEncryptor } from "./encryption.ts";

type SealEncryptionClient = Pick<SealClient, "encrypt">;
type SuiNetwork = ConstructorParameters<typeof SuiJsonRpcClient>[0]["network"];

export interface SealNetworkOptions {
  network: SuiNetwork;
  rpcUrl: string;
  serverConfigs: KeyServerConfig[];
  verifyKeyServers?: boolean;
  timeout?: number;
}

export function validateSealNetworkOptions(options: SealNetworkOptions): SealNetworkOptions {
  let url: URL;
  try {
    url = new URL(options.rpcUrl);
  } catch {
    throw new BatonError("INVALID_STATE", "Seal RPC URL is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BatonError("INVALID_STATE", "Seal RPC URL must use http or https");
  }
  if (options.serverConfigs.length === 0) {
    throw new BatonError("INVALID_STATE", "at least one Seal key server is required");
  }
  if (options.serverConfigs.some((server) => !/^0x[a-fA-F0-9]+$/.test(server.objectId) || server.weight < 1)) {
    throw new BatonError("INVALID_STATE", "Seal key servers require a hex object id and positive weight");
  }
  return options;
}

/** Actual Mysten Seal adapter; all SDK-specific behavior stays in this file. */
export class SealPayloadEncryptor implements PayloadEncryptor {
  readonly #client: SealEncryptionClient;

  constructor(client: SealEncryptionClient) {
    this.#client = client;
  }

  async encrypt(request: EncryptionRequest): Promise<Uint8Array> {
    const { encryptedObject } = await this.#client.encrypt({
      threshold: request.threshold,
      packageId: request.packageId,
      id: request.identity,
      data: request.data,
      aad: request.aad,
    });
    // Seal also returns the symmetric key. Baton deliberately does not retain
    // it: access must flow through the on-chain policy and key servers.
    return encryptedObject;
  }
}

export function createSealPayloadEncryptor(options: SealNetworkOptions): SealPayloadEncryptor {
  validateSealNetworkOptions(options);
  const suiClient = new SuiJsonRpcClient({ network: options.network, url: options.rpcUrl });
  const client = new SealClient({
    suiClient,
    serverConfigs: options.serverConfigs,
    verifyKeyServers: options.verifyKeyServers,
    timeout: options.timeout,
  });
  return new SealPayloadEncryptor(client);
}
