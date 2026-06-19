import { ProjectStore } from "../../store/project.js";
import { shortId } from "../../core/hash.js";
import { listHandoffs } from "../../core/query.js";
export function runLog(cwd) {
    const store = ProjectStore.open(cwd);
    const head = store.config().head;
    const entries = listHandoffs(store);
    if (entries.length === 0) {
        console.log("no batons yet — run `baton pass`");
        return;
    }
    for (const { id, handoff } of entries) {
        const mark = id === head ? "*" : " ";
        const fidelity = handoff.fidelity.score === null ? "—" : handoff.fidelity.score.toFixed(2);
        console.log(`${mark} ${shortId(id)}  ${handoff.meta.timestamp}  ${handoff.meta.tool}  ` +
            `fidelity ${fidelity}  ${handoff.mission || "(no mission)"}`);
    }
}
//# sourceMappingURL=log.js.map