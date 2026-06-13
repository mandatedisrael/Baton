import { userInfo } from "node:os";
import { finalize } from "../../core/finalize.ts";
import { shortId } from "../../core/hash.ts";
import { ProjectStore } from "../../store/project.ts";
import { ok, warn } from "../output.ts";

/**
 * `baton pass` — seal the current WorkingState into a handoff (commit).
 *
 * Phase 1 honesty: capture is `fallback` (no distiller yet), fidelity is
 * null, and the baton is local-only (Walrus/Sui anchoring is phase 3).
 * The shape of the flow — finalize → verify → persist → advance head —
 * is the real one and won't change.
 */
export function runPass(cwd: string): void {
  const store = ProjectStore.open(cwd);
  const config = store.config();
  const state = store.loadWorkingState();

  if (state.mission === "" && state.decisions.length === 0 && state.graveyard.length === 0) {
    warn("working state is empty — passing anyway, but this baton carries nothing yet");
  }

  const { handoff, id } = finalize(state, {
    projectId: config.projectId,
    author: userInfo().username,
    tool: "other", // tool detection arrives with capture adapters (phase 2)
    captureMode: "fallback",
    parents: config.head ? [config.head] : [],
  });

  store.saveHandoff(handoff, id);
  store.setHead(id);

  const lineage = handoff.meta.parents.length
    ? ` ← ${shortId(handoff.meta.parents[0]!)}`
    : "";
  ok(`baton ${shortId(id)} passed${lineage} (local-only; anchoring lands in phase 3)`);
}
