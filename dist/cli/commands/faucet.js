import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { loadIdentity } from "../../chain/identity.js";
import { BatonError } from "../../core/errors.js";
import { ok } from "../output.js";
export async function runFaucet(identityPath) {
    const { record } = loadIdentity(identityPath);
    let response;
    try {
        response = await requestSuiFromFaucetV2({
            host: getFaucetHost("testnet"),
            recipient: record.address,
        });
    }
    catch (err) {
        throw new BatonError("IO_ERROR", `Testnet faucet request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (response.status !== "Success" || !response.coins_sent || response.coins_sent.length === 0) {
        const detail = response.status === "Success" ? "no coins returned" : response.status.Failure.internal;
        throw new BatonError("IO_ERROR", `Testnet faucet request failed: ${detail}`);
    }
    const total = response.coins_sent.reduce((sum, coin) => sum + BigInt(coin.amount), 0n);
    ok(`Testnet identity funded: ${record.address} · ${total} MIST`);
}
//# sourceMappingURL=faucet.js.map