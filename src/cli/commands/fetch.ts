import { ProjectStore } from "../../store/project.ts";
import { ok } from "../output.ts";
import { ensureHandoffAvailable, recoverHandoffFromRemote } from "../remote.ts";

export async function runFetch(cwd: string, handoffId: string): Promise<void> {
  const store = ProjectStore.open(cwd);
  await ensureHandoffAvailable(store, handoffId, (id) => recoverHandoffFromRemote(store, id));
  ok(`baton ${handoffId.slice(0, 12)} is verified and available locally`);
}
