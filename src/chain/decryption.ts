import { BatonError } from "../core/errors.ts";
import { hashBytes } from "../core/hash.ts";
import type { UploadBlobKind } from "../schema/remote.ts";
import type { RemoteAuthority } from "../schema/project.ts";
import { sealIdentity } from "./encryption.ts";

export interface RemoteBlobDescriptor {
  id: string;
  kind: UploadBlobKind;
  contentHash: string;
  blobId: string;
}

export interface DecryptionRequest {
  packageId: string;
  projectObjectId: string;
  authority: RemoteAuthority;
  handoffId: string;
  identity: string;
  data: Uint8Array;
}

export interface PayloadDecryptor {
  decrypt(request: DecryptionRequest): Promise<Uint8Array>;
}

export async function decryptBlob(input: {
  decryptor: PayloadDecryptor;
  packageId: string;
  projectObjectId: string;
  authority: RemoteAuthority;
  handoffId: string;
  blob: RemoteBlobDescriptor;
  ciphertext: Uint8Array;
}): Promise<Uint8Array> {
  const plaintext = await input.decryptor.decrypt({
    packageId: input.packageId,
    projectObjectId: input.projectObjectId,
    authority: input.authority,
    handoffId: input.handoffId,
    identity: sealIdentity(input.projectObjectId, input.handoffId),
    data: input.ciphertext,
  });
  const actual = hashBytes(plaintext);
  if (actual !== input.blob.contentHash) {
    throw new BatonError(
      "HASH_MISMATCH",
      `decrypted ${input.blob.kind} ${input.blob.id} hashes to ${actual}, expected ${input.blob.contentHash}`,
    );
  }
  return plaintext;
}
