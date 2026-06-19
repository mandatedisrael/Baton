import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { walrus, type WriteBlobStep } from "@mysten/walrus";
import { BatonError } from "../core/errors.ts";
import type { RemoteProjectConfig } from "../schema/project.ts";
import type { WalrusResumeStep } from "../schema/remote.ts";

export interface WalrusUploadInput {
  data: Uint8Array;
  resume: WalrusResumeStep | null;
  onCheckpoint: (step: WalrusResumeStep) => void | Promise<void>;
}

export interface WalrusUploader {
  upload(input: WalrusUploadInput): Promise<{ blobId: string }>;
}

interface WalrusWriteFlow {
  run(options: {
    signer: Ed25519Keypair;
    epochs: number;
    deletable: boolean;
  }): AsyncIterable<WriteBlobStep>;
}

/**
 * Drive an official Walrus write flow and durably expose every resumable step.
 * A blob is successful only after the SDK returns its certified checkpoint.
 */
export async function runWalrusWriteFlow(
  flow: WalrusWriteFlow,
  input: {
    keypair: Ed25519Keypair;
    epochs: number;
    deletable: boolean;
    onCheckpoint: WalrusUploadInput["onCheckpoint"];
  },
): Promise<{ blobId: string }> {
  let certifiedBlobId: string | null = null;
  for await (const step of flow.run({
    signer: input.keypair,
    epochs: input.epochs,
    deletable: input.deletable,
  })) {
    if (step.step === "certified") {
      certifiedBlobId = step.blobId;
    } else {
      await input.onCheckpoint(step);
    }
  }
  if (certifiedBlobId === null) {
    throw new BatonError("INVALID_STATE", "Walrus write flow ended before blob certification");
  }
  return { blobId: certifiedBlobId };
}

/** Create a production uploader backed by Mysten's Walrus SDK and relay. */
export function createWalrusUploader(input: {
  remote: RemoteProjectConfig;
  keypair: Ed25519Keypair;
}): WalrusUploader {
  const client = new SuiGrpcClient({
    network: input.remote.network,
    baseUrl: input.remote.rpcUrl,
  }).$extend(
    walrus({
      uploadRelay: {
        host: input.remote.walrus.uploadRelayUrl,
        sendTip: { max: input.remote.walrus.maxTipMist },
      },
      storageNodeClientOptions: { timeout: 60_000 },
    }),
  );

  return {
    async upload(request) {
      const flow = client.walrus.writeBlobFlow({
        blob: request.data,
        ...(request.resume ? { resume: request.resume as WriteBlobStep } : {}),
      });
      try {
        return await runWalrusWriteFlow(flow, {
          keypair: input.keypair,
          epochs: input.remote.walrus.epochs,
          deletable: input.remote.walrus.deletable,
          onCheckpoint: request.onCheckpoint,
        });
      } catch (err) {
        if (err instanceof BatonError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new BatonError(
          "IO_ERROR",
          `Walrus upload failed: ${message}. The Baton identity must hold SUI for gas and WAL for storage`,
          { cause: err },
        );
      }
    },
  };
}
