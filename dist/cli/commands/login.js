import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { loadOrCreateIdentity, saveZkLoginIdentity } from "../../chain/identity.js";
import { TESTNET_RPC_URL } from "../../chain/networks.js";
import { performZkLogin, } from "../../chain/zklogin.js";
import { ok, warn } from "../output.js";
export async function runLogin(opts = {}) {
    const { identityPath } = opts;
    if (opts.zk) {
        const rpcUrl = TESTNET_RPC_URL;
        const client = new SuiJsonRpcClient({ network: "testnet", url: rpcUrl });
        const config = {
            provider: opts.provider ?? "google",
            clientId: opts.clientId,
        };
        const { session } = await performZkLogin(client, config);
        saveZkLoginIdentity(session, identityPath);
        ok(`Baton zkLogin identity ready: ${session.address} (provider: ${session.provider})`);
        warn("IMPORTANT: Back up your userSalt securely. If lost you cannot recover this address or decrypt shared data.");
        warn(`Salt (keep private): ${session.userSalt}`);
        ok("To re-display salt later: run `baton login --zk` again (it will show if re-auth needed).");
        return;
    }
    // Default / legacy path: raw Ed25519 (works for CI and advanced users)
    const { record } = loadOrCreateIdentity(identityPath);
    ok(`Baton identity ready: ${record.address}`);
}
//# sourceMappingURL=login.js.map