import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { loadIdentity, requireEd25519Identity } from "../../chain/identity.ts";
import { TESTNET_RPC_URL } from "../../chain/networks.ts";
import { DEFAULT_WAL_FUNDING_MIST, exchangeTestnetSuiForWal } from "../../chain/wal-funding.ts";
import { BatonError } from "../../core/errors.ts";
import { ok } from "../output.ts";

export async function runFundStorage(amountMist = DEFAULT_WAL_FUNDING_MIST, identityPath?: string): Promise<void> {
  const loaded = loadIdentity(identityPath);
  const { record, keypair } = requireEd25519Identity(loaded);
  const client = new SuiJsonRpcClient({ network: "testnet", url: TESTNET_RPC_URL });
  const balance = await client.getBalance({ owner: record.address });
  if (BigInt(balance.totalBalance) <= amountMist) {
    throw new BatonError(
      "INVALID_STATE",
      `Baton identity needs more Testnet SUI to exchange ${amountMist} MIST and pay gas — run \`baton faucet\``,
    );
  }
  const digest = await exchangeTestnetSuiForWal({ client, keypair, amountMist });
  ok(`storage funded with ${amountMist} FROST of Testnet WAL: ${digest}`);
}
