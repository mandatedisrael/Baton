import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiObjectId } from "@mysten/sui/utils";
import { BatonError } from "../core/errors.ts";
import type { LoadedIdentity } from "./identity.ts";
import { signTransactionWithZkLogin } from "./zklogin.ts";
import { getEd25519Keypair } from "./identity.ts";

export const TESTNET_WAL_EXCHANGE =
  "0xf4d164ea2def5fe07dc573992a029e010dba09b1a8dcbc44c5c2e79567f39073";
export const DEFAULT_WAL_FUNDING_MIST = 100_000_000n;

export function buildWalExchangeTransaction(input: {
  exchangePackageId: string;
  exchangeObjectId: string;
  recipient: string;
  amountMist: bigint;
}): Transaction {
  if (input.amountMist <= 0n || input.amountMist > 1_000_000_000_000n) {
    throw new BatonError("INVALID_STATE", "WAL funding amount must be between 1 MIST and 1,000 SUI");
  }
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(input.amountMist)]);
  const wal = tx.moveCall({
    target: `${normalizeSuiObjectId(input.exchangePackageId)}::wal_exchange::exchange_all_for_wal`,
    arguments: [tx.object(input.exchangeObjectId), payment!],
  });
  tx.transferObjects([wal], input.recipient);
  return tx;
}

export async function exchangeTestnetSuiForWal(input: {
  client: SuiJsonRpcClient;
  keypair?: Ed25519Keypair;
  identity?: LoadedIdentity;
  amountMist?: bigint;
  exchangeObjectId?: string;
}): Promise<string> {
  const exchangeObjectId = input.exchangeObjectId ?? TESTNET_WAL_EXCHANGE;
  const exchange = await input.client.getObject({ id: exchangeObjectId, options: { showType: true } });
  const type = exchange.data?.type;
  const match = type && /^(0x[a-fA-F0-9]+)::wal_exchange::Exchange$/.exec(type);
  if (!match) {
    throw new BatonError("INVALID_STATE", `official WAL exchange object ${exchangeObjectId} has an unexpected type`);
  }

  const recipient = input.identity ? input.identity.record.address : input.keypair!.toSuiAddress();
  const transaction = buildWalExchangeTransaction({
    exchangePackageId: match[1]!,
    exchangeObjectId,
    recipient,
    amountMist: input.amountMist ?? DEFAULT_WAL_FUNDING_MIST,
  });

  try {
    let response;
    if (input.identity && input.identity.scheme === "ZKLOGIN") {
      const zkSig = await signTransactionWithZkLogin({
        session: input.identity.session,
        client: input.client,
        transaction,
      });
      const bytes = await transaction.build({ client: input.client });
      response = await input.client.executeTransactionBlock({
        transactionBlock: bytes,
        signature: zkSig,
        options: { showEffects: true },
      });
    } else {
      const kp = input.keypair ?? getEd25519Keypair(input.identity!);
      response = await input.client.signAndExecuteTransaction({
        transaction,
        signer: kp,
        options: { showEffects: true },
      });
    }
    if (response.effects?.status.status !== "success") {
      throw new BatonError("IO_ERROR", `WAL exchange failed: ${response.effects?.status.error ?? "unknown error"}`);
    }
    await input.client.waitForTransaction({ digest: response.digest });
    return response.digest;
  } catch (err) {
    if (err instanceof BatonError) throw err;
    throw new BatonError(
      "IO_ERROR",
      `WAL exchange request failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
