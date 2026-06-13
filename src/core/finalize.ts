/**
 * finalize — "pass = commit" (plan §3.3.2).
 *
 * Turns the accumulated WorkingState into an immutable, validated,
 * content-addressed Handoff. Pure: no IO, no clock access beyond the
 * caller-supplied timestamp. The secrets scrub and fidelity grading slot
 * in before/after this call in the pass pipeline (phase 2).
 */
import { hashCanonical } from "./hash.ts";
import { BatonError } from "./errors.ts";
import {
  parseHandoff,
  SCHEMA_VERSION,
  type Attachment,
  type CaptureMode,
  type Fidelity,
  type Handoff,
  type ToolId,
} from "../schema/handoff.ts";
import type { WorkingState } from "./working-state.ts";

export interface FinalizeMeta {
  projectId: string;
  author: string;
  tool: ToolId;
  captureMode: CaptureMode;
  parents: string[];
  branch?: string;
  model?: string;
  timestamp?: string;
  /** Raw source attachments (e.g. the transcript) that travel with the handoff. */
  attachments?: Attachment[];
  /** Grader output; defaults to ungraded (`score: null`) — honest until graded. */
  fidelity?: Fidelity;
}

export interface FinalizedHandoff {
  handoff: Handoff;
  /** SHA-256 of the handoff's canonical JSON — the handoff's identity. */
  id: string;
}

export function finalize(state: WorkingState, meta: FinalizeMeta): FinalizedHandoff {
  const candidate = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      projectId: meta.projectId,
      branch: meta.branch,
      tool: meta.tool,
      captureMode: meta.captureMode,
      model: meta.model,
      author: meta.author,
      timestamp: meta.timestamp ?? new Date().toISOString(),
      parents: meta.parents,
    },
    mission: state.mission,
    status: state.status,
    decisions: state.decisions,
    graveyard: state.graveyard,
    repoMap: state.repoMap,
    nextActions: state.nextActions,
    envNotes: state.envNotes,
    attachments: meta.attachments ?? [],
    verbatimRules: state.verbatimRules,
    fidelity: meta.fidelity ?? { score: null }, // null is honest until graded
  };

  let handoff: Handoff;
  try {
    handoff = parseHandoff(candidate);
  } catch (err) {
    throw new BatonError("INVALID_HANDOFF", "working state does not finalize to a valid handoff", {
      cause: err,
    });
  }

  return { handoff, id: hashCanonical(handoff) };
}
