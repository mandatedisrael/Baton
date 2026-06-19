import { BatonError } from "../core/errors.js";
import { ProjectStore } from "../store/project.js";
/** Resolve a possibly-short baton id, or the current head when omitted. */
export function resolveHandoffId(store, idPrefix) {
    if (idPrefix === undefined) {
        const head = store.config().head;
        if (head === null)
            throw new BatonError("NOT_FOUND", "no batons yet — run `baton pass` first");
        return head;
    }
    const matches = store.listHandoffIds().filter((id) => id.startsWith(idPrefix));
    // A full content id is sufficient to query the on-chain manifest even when
    // this machine has never seen the baton locally.
    if (matches.length === 0 && /^[a-f0-9]{64}$/.test(idPrefix))
        return idPrefix;
    if (matches.length === 0)
        throw new BatonError("NOT_FOUND", `no baton matching "${idPrefix}"`);
    if (matches.length > 1) {
        throw new BatonError("NOT_FOUND", `ambiguous id "${idPrefix}" (${matches.length} matches)`);
    }
    return matches[0];
}
//# sourceMappingURL=resolve.js.map