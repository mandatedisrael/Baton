import { ProjectStore } from "../store/project.js";
export function projectStatus(store) {
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
//# sourceMappingURL=status.js.map