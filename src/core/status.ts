import type { HandoffStatus } from "../schema/handoff.ts";
import { ProjectStore } from "../store/project.ts";

export interface ProjectStatus {
  projectId: string;
  head: string | null;
  mission: string;
  status: HandoffStatus;
  decisions: number;
  graveyard: number;
  nextActions: string[];
  checkpoints: number;
  remoteRegistered: boolean;
}

export function projectStatus(store: ProjectStore): ProjectStatus {
  const config = store.config();
  const state = store.loadWorkingState();
  return {
    projectId: config.projectId,
    head: config.head,
    mission: state.mission,
    status: state.status,
    decisions: state.decisions.length,
    graveyard: state.graveyard.length,
    nextActions: [...state.nextActions],
    checkpoints: state.checkpointCount,
    remoteRegistered: config.remote !== null,
  };
}
