import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

import { loadOrCreateIdentity, saveZkLoginIdentity, type LoadedIdentity } from "../../chain/identity.ts";
import { TESTNET_RPC_URL } from "../../chain/networks.ts";
import {
  performZkLogin,
  type ZkLoginConfig,
} from "../../chain/zklogin.ts";
import { ok, warn } from "../output.ts";

export interface LoginOptions {
  identityPath?: string;
  /** Use zkLogin instead of (or in addition to) raw keypair */
  zk?: boolean;
  provider?: "google";
  clientId?: string;
}

export async function runLogin(opts: LoginOptions = {}): Promise<void> {
  const { identityPath } = opts;

  if (opts.zk) {
    const rpcUrl = TESTNET_RPC_URL;
    const client = new SuiJsonRpcClient({ network: "testnet", url: rpcUrl });

    const config: ZkLoginConfig = {
      provider: opts.provider ?? "google",
      clientId: opts.clientId,
    };

    const { session } = await performZkLogin(client, config);

    saveZkLoginIdentity(session, identityPath);

    ok(`Baton zkLogin identity ready: ${session.address} (provider: ${session.provider})`);
    warn("IMPORTANT: Back up your userSalt. If lost you cannot recover this address.");
    warn(`Salt: ${session.userSalt}`);
    return;
  }

  // Default / legacy path: raw Ed25519 (works for CI and advanced users)
  const { record } = loadOrCreateIdentity(identityPath);
  ok(`Baton identity ready: ${record.address}`);
}
