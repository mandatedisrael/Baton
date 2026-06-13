/**
 * WorkingState — the rolling, local state of a live session (plan §2.1).
 *
 * Micro-checkpoints (phase 2) don't rewrite this wholesale; they propose
 * small PatchOps. Small targets, small errors, self-correcting: later
 * checkpoints overwrite earlier mistakes ("latest truth wins").
 *
 * Everything here is a pure function: (state, op) → new state. The distiller
 * plugs in later without this module changing.
 */
import type {
  Decision,
  FileRef,
  GraveyardEntry,
  HandoffStatus,
  RepoMap,
} from "../schema/handoff.ts";

export interface WorkingState {
  schemaVersion: 1;
  mission: string;
  status: HandoffStatus;
  decisions: Decision[];
  graveyard: GraveyardEntry[];
  repoMap: RepoMap;
  nextActions: string[];
  envNotes: string[];
  verbatimRules: string[];
  checkpointCount: number;
  updatedAt: string;
}

export function emptyWorkingState(now: Date = new Date()): WorkingState {
  return {
    schemaVersion: 1,
    mission: "",
    status: "in-progress",
    decisions: [],
    graveyard: [],
    repoMap: { touched: [], important: [], entryPoints: [] },
    nextActions: [],
    envNotes: [],
    verbatimRules: [],
    checkpointCount: 0,
    updatedAt: now.toISOString(),
  };
}

/** The checkpoint vocabulary: ADD / UPDATE / GRAVEYARD / NOOP (plan §3.3). */
export type PatchOp =
  | { kind: "set_mission"; mission: string }
  | { kind: "set_status"; status: HandoffStatus }
  | { kind: "add_decision"; decision: Decision }
  | { kind: "update_decision"; id: string; patch: Partial<Omit<Decision, "id">> }
  | {
      /** Move a failed decision (or record a fresh failure) into the graveyard. */
      kind: "move_to_graveyard";
      entry: GraveyardEntry;
      decisionId?: string;
    }
  | { kind: "set_next_actions"; actions: string[] }
  | { kind: "add_env_note"; note: string }
  | { kind: "add_verbatim_rule"; rule: string }
  | { kind: "touch_files"; files: FileRef[] }
  | { kind: "noop"; reason?: string };

export function applyPatch(state: WorkingState, op: PatchOp, now: Date = new Date()): WorkingState {
  const next = patch(state, op);
  if (next === state) return state; // true no-op: don't bump bookkeeping
  return { ...next, checkpointCount: state.checkpointCount + 1, updatedAt: now.toISOString() };
}

export function applyPatches(
  state: WorkingState,
  ops: PatchOp[],
  now: Date = new Date(),
): WorkingState {
  return ops.reduce((s, op) => applyPatch(s, op, now), state);
}

function patch(state: WorkingState, op: PatchOp): WorkingState {
  switch (op.kind) {
    case "set_mission":
      return { ...state, mission: op.mission };

    case "set_status":
      return { ...state, status: op.status };

    case "add_decision":
      return { ...state, decisions: [...state.decisions, op.decision] };

    case "update_decision": {
      const i = state.decisions.findIndex((d) => d.id === op.id);
      if (i === -1) return state;
      const decisions = [...state.decisions];
      decisions[i] = { ...decisions[i]!, ...op.patch };
      return { ...state, decisions };
    }

    case "move_to_graveyard": {
      const decisions =
        op.decisionId === undefined
          ? state.decisions
          : state.decisions.filter((d) => d.id !== op.decisionId);
      return { ...state, decisions, graveyard: [...state.graveyard, op.entry] };
    }

    case "set_next_actions":
      return { ...state, nextActions: [...op.actions] };

    case "add_env_note":
      return { ...state, envNotes: [...state.envNotes, op.note] };

    case "add_verbatim_rule":
      return { ...state, verbatimRules: [...state.verbatimRules, op.rule] };

    case "touch_files": {
      // Merge by path, latest wins.
      const byPath = new Map(state.repoMap.touched.map((f) => [f.path, f]));
      for (const f of op.files) byPath.set(f.path, f);
      return {
        ...state,
        repoMap: { ...state.repoMap, touched: [...byPath.values()] },
      };
    }

    case "noop":
      return state;
  }
}
