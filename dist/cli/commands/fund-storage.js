import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { loadIdentity } from "../../chain/identity.js";
import { TESTNET_RPC_URL } from "../../chain/networks.js";
import { DEFAULT_WAL_FUNDING_MIST, exchangeTestnetSuiForWal } from "../../chain/wal-funding.js";
import { BatonError } from "../../core/errors.js";
import { ok } from "../output.js";
export async function runFundStorage(amountMist = DEFAULT_WAL_FUNDING_MIST, identityPath) {
    const loaded = loadIdentity(identityPath);
    const client = new SuiJsonRpcClient({ network: "testnet", url: TESTNET_RPC_URL });
    const balance = await client.getBalance({ owner: loaded.record.address });
    if (BigInt(balance.totalBalance) <= amountMist) {
        throw new BatonError("INVALID_STATE", `Baton identity needs more Testnet SUI to exchange ${amountMist} MIST and pay gas — run \`baton faucet\``);
    }
    const digest = await exchangeTestnetSuiForWal({ client, identity: loaded, amountMist });
    ok(`storage funded with ${amountMist} FROST of Testnet WAL: ${digest}`);
}
//# sourceMappingURL=fund-storage.js.map