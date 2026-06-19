import { ProjectStore } from "../../store/project.js";
import { resolveHandoffId } from "../resolve.js";
import { ensureHandoffAvailable, recoverHandoffFromRemote } from "../remote.js";
import { buildResumePrompt } from "../../core/resume.js";
/**
 * `baton resume [id]` — render the resume prompt for a verified handoff.
 *
 * Walks the first-parent lineage so the receiving agent sees where this baton
 * came from. Output goes to stdout for piping/injection; the MCP server
 * (phase 4) will inject the same rendering directly into the tool.
 */
export async function runResume(cwd, idPrefix, receivingTool) {
    const store = ProjectStore.open(cwd);
    const id = resolveHandoffId(store, idPrefix);
    const handoff = await ensureHandoffAvailable(store, id, (missingId) => recoverHandoffFromRemote(store, missingId));
    process.stdout.write(buildResumePrompt(store, id, handoff, receivingTool));
}
//# sourceMappingURL=resume.js.map