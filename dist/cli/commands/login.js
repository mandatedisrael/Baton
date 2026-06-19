import { loadOrCreateIdentity } from "../../chain/identity.js";
import { ok } from "../output.js";
export function runLogin(identityPath) {
    const { record } = loadOrCreateIdentity(identityPath);
    ok(`Baton identity ready: ${record.address}`);
}
//# sourceMappingURL=login.js.map