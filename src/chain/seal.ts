import { EncryptedObject, SealClient, SessionKey, type KeyServerConfig } from "@mysten/seal";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { BatonError } from "../core/errors.ts";
import type { EncryptionRequest, PayloadEncryptor } from "./encryption.ts";
import type { DecryptionRequest, PayloadDecryptor } from "./decryption.ts";

type SealEncryptionClient = Pick<SealClient, "encrypt">;
type SealDecryptionClient = Pick<SealClient, "decrypt">;
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

export function buildSealApprovalTransaction(request: Pick<
  DecryptionRequest,
  "packageId" | "policyPackageId" | "projectObjectId" | "authority" | "identity"
>): Transaction {
  const identity = request.identity.startsWith("0x") ? request.identity.slice(2) : request.identity;
  if (!/^[a-fA-F0-9]{128}$/.test(identity)) {
    throw new BatonError("INVALID_STATE", "Seal decryption identity must contain project and content hashes");
  }
  const tx = new Transaction();
  tx.moveCall({
    target: `${request.policyPackageId}::memory::${request.authority.kind === "owner" ? "seal_approve" : "seal_approve_shared"}`,
    arguments: [
      tx.pure.vector("u8", Uint8Array.from(Buffer.from(identity, "hex"))),
      tx.object(request.projectObjectId),
      tx.object(request.authority.capId),
    ],
  });
  return tx;
}

export class SealPayloadDecryptor implements PayloadDecryptor {
  readonly #client: SealDecryptionClient;
  readonly #suiClient: SuiJsonRpcClient;
  readonly #keypair: Ed25519Keypair;
  #sessionKey: SessionKey | null = null;

  constructor(client: SealDecryptionClient, suiClient: SuiJsonRpcClient, keypair: Ed25519Keypair) {
    this.#client = client;
    this.#suiClient = suiClient;
    this.#keypair = keypair;
  }

  async decrypt(request: DecryptionRequest): Promise<Uint8Array> {
    let encrypted;
    try {
      encrypted = EncryptedObject.parse(request.data);
    } catch (err) {
      throw new BatonError("INVALID_STATE", "Walrus payload is not a valid Seal encrypted object", { cause: err });
    }
    const expectedIdentity = request.identity.replace(/^0x/, "").toLowerCase();
    if (encrypted.id.toLowerCase() !== expectedIdentity) {
      throw new BatonError("HASH_MISMATCH", "Seal ciphertext identity does not match the requested project payload");
    }
    if (encrypted.packageId.toLowerCase() !== request.packageId.toLowerCase()) {
      throw new BatonError("HASH_MISMATCH", "Seal ciphertext package does not match the registered Baton contract");
    }
    if (this.#sessionKey === null || this.#sessionKey.isExpired()) {
      this.#sessionKey = await SessionKey.create({
        address: this.#keypair.toSuiAddress(),
        packageId: request.packageId,
        ttlMin: 10,
        signer: this.#keypair,
        suiClient: this.#suiClient,
      });
    }
    const transaction = buildSealApprovalTransaction(request);
    const txBytes = await transaction.build({ client: this.#suiClient, onlyTransactionKind: true });
    try {
      return await this.#client.decrypt({ data: request.data, sessionKey: this.#sessionKey, txBytes });
    } catch (err) {
      throw new BatonError(
        "IO_ERROR",
        `Seal decryption failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

export function createSealPayloadDecryptor(
  options: SealNetworkOptions & { keypair: Ed25519Keypair },
): SealPayloadDecryptor {
  validateSealNetworkOptions(options);
  const suiClient = new SuiJsonRpcClient({ network: options.network, url: options.rpcUrl });
  const client = new SealClient({
    suiClient,
    serverConfigs: options.serverConfigs,
    verifyKeyServers: options.verifyKeyServers,
    timeout: options.timeout,
  });
  return new SealPayloadDecryptor(client, suiClient, options.keypair);
}
