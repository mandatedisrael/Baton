import { BatonError } from "../core/errors.ts";
import { ProjectStore } from "../store/project.ts";

/** Resolve a possibly-short baton id, or the current head when omitted. */
export function resolveHandoffId(store: ProjectStore, idPrefix?: string): string {
  if (idPrefix === undefined) {
    const head = store.config().head;
    if (head === null) throw new BatonError("NOT_FOUND", "no batons yet — run `baton pass` first");
    return head;
  }
  const matches = store.listHandoffIds().filter((id) => id.startsWith(idPrefix));
  if (matches.length === 0) throw new BatonError("NOT_FOUND", `no baton matching "${idPrefix}"`);
  if (matches.length > 1) {
    throw new BatonError("NOT_FOUND", `ambiguous id "${idPrefix}" (${matches.length} matches)`);
  }
  return matches[0]!;
}
