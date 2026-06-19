import { z } from "zod";
import { listHandoffs, searchHandoffs } from "../core/query.js";
import { buildResumePrompt } from "../core/resume.js";
import { TOOL_IDS } from "../schema/handoff.js";
import { ProjectStore } from "../store/project.js";
import { verificationEvidenceFromStore } from "../cli/commands/verify.js";
import { ensureHandoffAvailable, recoverHandoffFromRemote } from "../cli/remote.js";
import { resolveHandoffId } from "../cli/resolve.js";
const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const remoteRead = { ...readOnly, openWorldHint: true };
function textAndStructured(text, structuredContent) {
    return { content: [{ type: "text", text }], structuredContent };
}
async function resolveAvailable(store, idPrefix) {
    const id = resolveHandoffId(store, idPrefix);
    const handoff = await ensureHandoffAvailable(store, id, (missingId) => recoverHandoffFromRemote(store, missingId));
    return { id, handoff };
}
export function registerReadTools(server, projectDir) {
    server.registerTool("baton_log", {
        title: "List verified batons",
        description: "List locally available, hash-verified batons newest first, including head and fidelity metadata.",
        inputSchema: { limit: z.number().int().min(1).max(100).optional().default(20) },
        outputSchema: {
            head: z.string().nullable(),
            entries: z.array(z.object({
                id: z.string(), timestamp: z.string(), tool: z.string(), status: z.string(),
                mission: z.string(), fidelity: z.number().nullable(), parents: z.array(z.string()),
            })),
        },
        annotations: readOnly,
    }, async ({ limit }) => {
        const store = ProjectStore.open(projectDir);
        const head = store.config().head;
        const entries = listHandoffs(store).slice(0, limit).map(({ id, handoff }) => ({
            id,
            timestamp: handoff.meta.timestamp,
            tool: handoff.meta.tool,
            status: handoff.status,
            mission: handoff.mission,
            fidelity: handoff.fidelity.score,
            parents: handoff.meta.parents,
        }));
        return textAndStructured(JSON.stringify({ head, entries }, null, 2), { head, entries });
    });
    server.registerTool("baton_search", {
        title: "Search verified batons",
        description: "Search missions, decisions, graveyard entries, next actions, environment notes, rules, and file paths.",
        inputSchema: {
            query: z.string().trim().min(1).describe("Case-insensitive text to find"),
            limit: z.number().int().min(1).max(50).optional().default(10),
        },
        outputSchema: {
            query: z.string(),
            results: z.array(z.object({
                id: z.string(), timestamp: z.string(), tool: z.string(), status: z.string(),
                mission: z.string(), matches: z.array(z.string()),
            })),
        },
        annotations: readOnly,
    }, async ({ query, limit }) => {
        const results = searchHandoffs(ProjectStore.open(projectDir), query, limit);
        return textAndStructured(JSON.stringify(results, null, 2), { query, results });
    });
    server.registerTool("baton_show", {
        title: "Show a verified baton",
        description: "Load a baton by local prefix or full remote content ID, recovering and verifying it if necessary.",
        inputSchema: { id: z.string().min(1).describe("Local prefix or full 64-character content ID") },
        outputSchema: { id: z.string(), handoff: z.record(z.string(), z.unknown()) },
        annotations: remoteRead,
    }, async ({ id: prefix }) => {
        const store = ProjectStore.open(projectDir);
        const { id, handoff } = await resolveAvailable(store, prefix);
        const structuredHandoff = { ...handoff };
        return textAndStructured(JSON.stringify(handoff, null, 2), { id, handoff: structuredHandoff });
    });
    server.registerTool("baton_resume", {
        title: "Resume from a verified baton",
        description: "Recover if needed, verify, and render the canonical Baton resume prompt with first-parent lineage.",
        inputSchema: {
            id: z.string().min(1).optional().describe("Baton prefix/full ID; defaults to project head"),
            receivingTool: z.enum(TOOL_IDS).optional().describe("Agent dialect receiving the handoff"),
        },
        outputSchema: { id: z.string(), prompt: z.string() },
        annotations: remoteRead,
    }, async ({ id: prefix, receivingTool }) => {
        const store = ProjectStore.open(projectDir);
        const { id, handoff } = await resolveAvailable(store, prefix);
        const prompt = buildResumePrompt(store, id, handoff, receivingTool);
        return textAndStructured(prompt, { id, prompt });
    });
    server.registerTool("baton_verify", {
        title: "Verify a Baton claim",
        description: "Return the hash-verified transcript lines cited by one decision or graveyard claim.",
        inputSchema: {
            claimId: z.string().min(1).describe("Decision or graveyard entry ID"),
            id: z.string().min(1).optional().describe("Baton prefix/full ID; defaults to project head"),
        },
        outputSchema: { id: z.string(), claimId: z.string(), evidence: z.string() },
        annotations: remoteRead,
    }, async ({ claimId, id: prefix }) => {
        const store = ProjectStore.open(projectDir);
        const { id } = await resolveAvailable(store, prefix);
        const evidence = verificationEvidenceFromStore(store, claimId, id);
        return textAndStructured(evidence, { id, claimId, evidence });
    });
}
//# sourceMappingURL=read-tools.js.map