import { BatonError } from "../../core/errors.js";
import { ProjectStore } from "../../store/project.js";
/** `baton show <id>` — print a verified handoff (accepts short ids). */
export function runShow(cwd, idPrefix) {
    const store = ProjectStore.open(cwd);
    const matches = store.listHandoffIds().filter((id) => id.startsWith(idPrefix));
    if (matches.length === 0)
        throw new BatonError("NOT_FOUND", `no baton matching "${idPrefix}"`);
    if (matches.length > 1) {
        throw new BatonError("NOT_FOUND", `ambiguous id "${idPrefix}" (${matches.length} matches)`);
    }
    // loadHandoff verifies the hash — tampered batons refuse to print.
    console.log(JSON.stringify(store.loadHandoff(matches[0]), null, 2));
}
//# sourceMappingURL=show.js.map