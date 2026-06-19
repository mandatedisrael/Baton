import { scrubDeep, type ScrubFinding } from "../distiller/scrub.ts";
import type { Decision, FileRef, GraveyardEntry, HandoffStatus } from "../schema/handoff.ts";
import { ProjectStore } from "../store/project.ts";
import type { WorkingState } from "./working-state.ts";

export interface SelfReportCheckpoint {
  mission?: string;
  status?: HandoffStatus;
  decisions?: Decision[];
  graveyard?: GraveyardEntry[];
  nextActions?: string[];
  envNotes?: string[];
  verbatimRules?: string[];
  touchedFiles?: FileRef[];
}

export interface SelfReportResult {
  state: WorkingState;
  findings: ScrubFinding[];
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function applySelfReportCheckpoint(
  store: ProjectStore,
  checkpoint: SelfReportCheckpoint,
  now: Date = new Date(),
): SelfReportResult {
  const current = store.loadWorkingState();
  const touched = new Map(current.repoMap.touched.map((file) => [file.path, file]));
  for (const file of checkpoint.touchedFiles ?? []) touched.set(file.path, file);
  const candidate: WorkingState = {
    ...current,
    ...(checkpoint.mission !== undefined ? { mission: checkpoint.mission } : {}),
    ...(checkpoint.status !== undefined ? { status: checkpoint.status } : {}),
    ...(checkpoint.decisions !== undefined ? { decisions: uniqueById(checkpoint.decisions) } : {}),
    ...(checkpoint.graveyard !== undefined ? { graveyard: uniqueById(checkpoint.graveyard) } : {}),
    ...(checkpoint.nextActions !== undefined ? { nextActions: [...checkpoint.nextActions] } : {}),
    ...(checkpoint.envNotes !== undefined ? { envNotes: [...checkpoint.envNotes] } : {}),
    ...(checkpoint.verbatimRules !== undefined ? { verbatimRules: [...checkpoint.verbatimRules] } : {}),
    repoMap: { ...current.repoMap, touched: [...touched.values()] },
    checkpointCount: current.checkpointCount + 1,
    updatedAt: now.toISOString(),
  };
  const { value, findings } = scrubDeep(candidate);
  const state = value as WorkingState;
  store.saveWorkingState(state);
  return { state, findings };
}
