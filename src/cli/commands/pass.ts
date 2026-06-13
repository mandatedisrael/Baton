import { userInfo } from "node:os";
import { finalize } from "../../core/finalize.ts";
import { shortId } from "../../core/hash.ts";
import { applyPatches, type WorkingState } from "../../core/working-state.ts";
import { ProjectStore } from "../../store/project.ts";
import { fallbackPatchOps, gatherFallbackSignal } from "../../distiller/fallback.ts";
import { scrubDeep } from "../../distiller/scrub.ts";
import { ok, warn } from "../output.ts";

/**
 * `baton pass` — seal the current WorkingState into a handoff (commit).
 *
 * With no distiller in the loop yet, capture is `fallback`: the deterministic
 * distiller enriches the working state from the git working tree (touched
 * files + content hashes, branch, TODO items) so a fallback baton still
 * carries real signal. Secrets are scrubbed before sealing. Fidelity is null —
 * honest until a grader runs (phase 2). The flow — enrich → scrub → finalize →
 * verify → persist → advance head — is the real one and won't change; the
 * micro-checkpoint distiller plugs in by populating the working state instead.
 */
export function runPass(cwd: string): void {
  const store = ProjectStore.open(cwd);
  const config = store.config();
  const state = store.loadWorkingState();

  // Enrich empty fields from the working tree — never clobber accumulated
  // checkpoint data (latest truth wins once the distiller is live).
  const signal = gatherFallbackSignal(store.root);
  const ops = fallbackPatchOps({
    branch: signal.branch,
    touched: state.repoMap.touched.length === 0 ? signal.touched : [],
    nextActions: state.nextActions.length === 0 ? signal.nextActions : [],
    envNotes: state.envNotes.length === 0 ? signal.envNotes : [],
  });
  const enriched = applyPatches(state, ops);

  // Scrub before anything is sealed or even re-saved locally.
  const { value, findings } = scrubDeep(enriched);
  const scrubbed = value as WorkingState;
  if (findings.length > 0) {
    const summary = findings.map((f) => `${f.count}× ${f.type}`).join(", ");
    warn(`scrubbed secrets before sealing: ${summary}`);
  }

  if (
    scrubbed.mission === "" &&
    scrubbed.decisions.length === 0 &&
    scrubbed.graveyard.length === 0 &&
    scrubbed.repoMap.touched.length === 0
  ) {
    warn("nothing to capture — clean working tree and empty state; passing an empty baton");
  }

  const { handoff, id } = finalize(scrubbed, {
    projectId: config.projectId,
    author: userInfo().username,
    tool: "other", // becomes the detected tool once capture is wired into pass
    captureMode: "fallback",
    branch: signal.branch ?? undefined,
    parents: config.head ? [config.head] : [],
  });

  store.saveHandoff(handoff, id);
  store.setHead(id);
  store.saveWorkingState(scrubbed); // keep local state secret-free and current

  const lineage = handoff.meta.parents.length ? ` ← ${shortId(handoff.meta.parents[0]!)}` : "";
  const touched = handoff.repoMap.touched.length;
  const detail = touched > 0 ? ` · ${touched} file(s) touched` : "";
  ok(`baton ${shortId(id)} passed${lineage}${detail} (local-only; anchoring lands in phase 3)`);
}
