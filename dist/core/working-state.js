export function emptyWorkingState(now = new Date()) {
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
export function applyPatch(state, op, now = new Date()) {
    const next = patch(state, op);
    if (next === state)
        return state; // true no-op: don't bump bookkeeping
    return { ...next, checkpointCount: state.checkpointCount + 1, updatedAt: now.toISOString() };
}
export function applyPatches(state, ops, now = new Date()) {
    return ops.reduce((s, op) => applyPatch(s, op, now), state);
}
function patch(state, op) {
    switch (op.kind) {
        case "set_mission":
            return { ...state, mission: op.mission };
        case "set_status":
            return { ...state, status: op.status };
        case "add_decision":
            return { ...state, decisions: [...state.decisions, op.decision] };
        case "update_decision": {
            const i = state.decisions.findIndex((d) => d.id === op.id);
            if (i === -1)
                return state;
            const decisions = [...state.decisions];
            decisions[i] = { ...decisions[i], ...op.patch };
            return { ...state, decisions };
        }
        case "move_to_graveyard": {
            const decisions = op.decisionId === undefined
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
            for (const f of op.files)
                byPath.set(f.path, f);
            return {
                ...state,
                repoMap: { ...state.repoMap, touched: [...byPath.values()] },
            };
        }
        case "noop":
            return state;
    }
}
//# sourceMappingURL=working-state.js.map