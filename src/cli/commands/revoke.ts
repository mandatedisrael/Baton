import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { loadIdentity } from "../../chain/identity.ts";
import { revokeAccessOnSui } from "../../chain/sharing.ts";
import { BatonError } from "../../core/errors.ts";
import { ProjectStore } from "../../store/project.ts";
import { ok } from "../output.ts";

export async function runRevoke(cwd: string, grantee: string, identityPath?: string): Promise<void> {
  const store = ProjectStore.open(cwd);
  const remote = store.config().remote;
  if (!remote) throw new BatonError("INVALID_STATE", "project is local-only — there is no remote access to revoke");
  const loaded = loadIdentity(identityPath);
  const client = new SuiJsonRpcClient({ network: remote.network, url: remote.rpcUrl });
  const digest = await revokeAccessOnSui({ client, identity: loaded, remote, grantee });
  ok(`read access revoked for ${grantee}`);
  ok(`Sui transaction: ${digest}`);
}
