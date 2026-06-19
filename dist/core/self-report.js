import { scrubDeep } from "../distiller/scrub.js";
import { ProjectStore } from "../store/project.js";
function uniqueById(items) {
    const seen = new Set();
    return items.filter((item) => {
        if (seen.has(item.id))
            return false;
        seen.add(item.id);
        return true;
    });
}
export function applySelfReportCheckpoint(store, checkpoint, now = new Date()) {
    const current = store.loadWorkingState();
    const touched = new Map(current.repoMap.touched.map((file) => [file.path, file]));
    for (const file of checkpoint.touchedFiles ?? [])
        touched.set(file.path, file);
    const candidate = {
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
    const state = value;
    store.saveWorkingState(state);
    return { state, findings };
}
//# sourceMappingURL=self-report.js.map