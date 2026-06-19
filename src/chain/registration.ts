import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiObjectId } from "@mysten/sui/utils";
import { BatonError } from "../core/errors.ts";

export interface RegistrationResult {
  digest: string;
  projectObjectId: string;
  ownerCapId: string;
}

export function buildRegistrationTransaction(packageId: string, projectId: string): Transaction {
  const normalizedPackage = normalizeSuiObjectId(packageId);
  const projectBytes = new TextEncoder().encode(projectId);
  if (projectBytes.byteLength === 0 || projectBytes.byteLength > 128) {
    throw new BatonError("INVALID_STATE", "project id must encode to 1–128 UTF-8 bytes");
  }
  const tx = new Transaction();
  tx.moveCall({
    target: `${normalizedPackage}::memory::create_project`,
    arguments: [tx.pure.vector("u8", projectBytes)],
  });
  return tx;
}

export function extractRegistrationObjects(
  packageId: string,
  changes: NonNullable<Awaited<ReturnType<SuiJsonRpcClient["signAndExecuteTransaction"]>>["objectChanges"]>,
): Pick<RegistrationResult, "projectObjectId" | "ownerCapId"> {
  const packagePrefix = normalizeSuiObjectId(packageId);
  const created = changes.filter((change) => change.type === "created");
  const project = created.find((change) => change.objectType === `${packagePrefix}::memory::ProjectMemory`);
  const cap = created.find((change) => change.objectType === `${packagePrefix}::memory::OwnerCap`);
  if (!project || project.type !== "created" || !cap || cap.type !== "created") {
    throw new BatonError("INVALID_STATE", "registration transaction did not create ProjectMemory and OwnerCap");
  }
  return { projectObjectId: project.objectId, ownerCapId: cap.objectId };
}

export async function registerProjectOnSui(input: {
  client: SuiJsonRpcClient;
  keypair: Ed25519Keypair;
  packageId: string;
  projectId: string;
}): Promise<RegistrationResult> {
  const transaction = buildRegistrationTransaction(input.packageId, input.projectId);
  let response;
  try {
    response = await input.client.signAndExecuteTransaction({
      transaction,
      signer: input.keypair,
      options: { showEffects: true, showObjectChanges: true },
    });
  } catch (err) {
    throw new BatonError(
      "IO_ERROR",
      `Sui registration request failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (response.effects?.status.status !== "success") {
    throw new BatonError(
      "IO_ERROR",
      `Sui registration failed: ${response.effects?.status.error ?? response.errors?.join("; ") ?? "unknown error"}`,
    );
  }
  if (!response.objectChanges) {
    throw new BatonError("INVALID_STATE", "Sui registration response omitted object changes");
  }
  const objects = extractRegistrationObjects(input.packageId, response.objectChanges);
  try {
    await input.client.waitForTransaction({ digest: response.digest });
  } catch (err) {
    throw new BatonError("IO_ERROR", `registration executed but indexing timed out: ${response.digest}`, {
      cause: err,
    });
  }
  return { digest: response.digest, ...objects };
}
