import { ProjectStore } from "../../store/project.js";
import { ok } from "../output.js";
import { ensureHandoffAvailable, recoverHandoffFromRemote } from "../remote.js";
export async function runFetch(cwd, handoffId) {
    const store = ProjectStore.open(cwd);
    await ensureHandoffAvailable(store, handoffId, (id) => recoverHandoffFromRemote(store, id));
    ok(`baton ${handoffId.slice(0, 12)} is verified and available locally`);
}
//# sourceMappingURL=fetch.js.map