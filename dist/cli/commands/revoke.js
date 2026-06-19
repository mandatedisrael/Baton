import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { loadIdentity } from "../../chain/identity.js";
import { revokeAccessOnSui } from "../../chain/sharing.js";
import { BatonError } from "../../core/errors.js";
import { ProjectStore } from "../../store/project.js";
import { ok } from "../output.js";
export async function runRevoke(cwd, grantee, identityPath) {
    const store = ProjectStore.open(cwd);
    const remote = store.config().remote;
    if (!remote)
        throw new BatonError("INVALID_STATE", "project is local-only — there is no remote access to revoke");
    const { keypair } = loadIdentity(identityPath);
    const client = new SuiJsonRpcClient({ network: remote.network, url: remote.rpcUrl });
    const digest = await revokeAccessOnSui({ client, keypair, remote, grantee });
    ok(`read access revoked for ${grantee}`);
    ok(`Sui transaction: ${digest}`);
}
//# sourceMappingURL=revoke.js.map