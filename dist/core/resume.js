import { shortId } from "./hash.js";
import { renderResumePrompt } from "../render/resume.js";
import { ProjectStore } from "../store/project.js";
const MAX_LINEAGE = 8;
export function buildResumePrompt(store, id, handoff, receivingTool) {
    const chain = [{ shortId: shortId(id), tool: handoff.meta.tool }];
    const seen = new Set([id]);
    let cursor = handoff.meta.parents[0];
    while (cursor && !seen.has(cursor) && chain.length < MAX_LINEAGE) {
        seen.add(cursor);
        let parent;
        try {
            parent = store.loadHandoff(cursor);
        }
        catch {
            break;
        }
        chain.push({ shortId: shortId(cursor), tool: parent.meta.tool });
        cursor = parent.meta.parents[0];
    }
    return renderResumePrompt(handoff, { chain, receivingTool });
}
//# sourceMappingURL=resume.js.map