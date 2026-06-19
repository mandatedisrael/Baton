import { userInfo } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { finalize } from "../../core/finalize.js";
import { shortId } from "../../core/hash.js";
import { applyPatches } from "../../core/working-state.js";
import { ProjectStore } from "../../store/project.js";
import { fallbackPatchOps, gatherFallbackSignal } from "../../distiller/fallback.js";
import { scrub, scrubDeep } from "../../distiller/scrub.js";
import { parseClaudeCodeTranscript } from "../../distiller/capture/claude-code.js";
import { transcriptAttachment } from "../../distiller/capture/transcript.js";
import { transcriptAttachmentId } from "../../distiller/checkpoint.js";
import { gradeHandoff } from "../../distiller/grade.js";
import { AnthropicClient } from "../../llm/anthropic.js";
import { renderReview } from "../../render/review.js";
import { confirm, ok, warn } from "../output.js";
import { createUploadJob } from "../../chain/queue.js";
const CLI_REPORTER = {
    warn,
    ok,
    write: (message) => process.stdout.write(message),
    confirm,
};
/**
 * `baton pass` — seal the current WorkingState into a handoff (commit).
 *
 * If micro-checkpoints captured a transcript (cursor records its path), the
 * baton is transcript-mode: the raw transcript travels as an attachment, the
 * tool is detected, and — with ANTHROPIC_API_KEY — a fidelity grader scores the
 * distillation against the source. Otherwise it falls back to enriching the
 * working state from the git tree. Either way: scrub → finalize → verify →
 * persist → advance head. Secrets are scrubbed before sealing; fidelity is null
 * until graded (honest, never faked).
 */
export async function passBaton(cwd, opts = {}, reporter = CLI_REPORTER) {
    const store = ProjectStore.open(cwd);
    const config = store.config();
    const state = store.loadWorkingState();
    const cursor = store.loadCursor();
    // Locate the source transcript (if checkpoints recorded one).
    let attachments;
    let transcriptText;
    let transcriptFindings = [];
    let tool = "other";
    let captureMode = "fallback";
    let model;
    if (cursor.transcriptPath && existsSync(cursor.transcriptPath)) {
        try {
            const scrubbedTranscript = scrub(readFileSync(cursor.transcriptPath, "utf8"));
            transcriptText = scrubbedTranscript.clean;
            transcriptFindings = scrubbedTranscript.findings;
            const session = parseClaudeCodeTranscript(transcriptText);
            const attId = transcriptAttachmentId(session);
            if (attId) {
                attachments = [transcriptAttachment(session, attId)];
                tool = "claude-code";
                captureMode = "transcript";
                model = session.model ?? undefined;
            }
        }
        catch {
            transcriptText = undefined; // unreadable transcript → fall back cleanly
        }
    }
    // Enrich empty fields from the working tree — never clobber checkpoint data.
    const signal = gatherFallbackSignal(store.root);
    const enriched = applyPatches(state, fallbackPatchOps({
        branch: signal.branch,
        touched: state.repoMap.touched.length === 0 ? signal.touched : [],
        nextActions: state.nextActions.length === 0 ? signal.nextActions : [],
        envNotes: state.envNotes.length === 0 ? signal.envNotes : [],
    }));
    // Scrub before anything is sealed or re-saved locally.
    const { value, findings: stateFindings } = scrubDeep(enriched);
    const scrubbed = value;
    const findings = [...stateFindings, ...transcriptFindings];
    if (findings.length > 0) {
        reporter.warn(`scrubbed secrets before sealing: ${findings.map((f) => `${f.count}× ${f.type}`).join(", ")}`);
    }
    if (scrubbed.mission === "" &&
        scrubbed.decisions.length === 0 &&
        scrubbed.graveyard.length === 0 &&
        scrubbed.repoMap.touched.length === 0 &&
        !transcriptText) {
        reporter.warn("nothing to capture — clean working tree and empty state; passing an empty baton");
    }
    // Review gate: show what's about to be sealed and require confirmation.
    if (opts.review) {
        const parent = config.head ? { id: config.head, handoff: store.loadHandoff(config.head) } : null;
        reporter.write("\n" + renderReview(scrubbed, { tool, captureMode, parent }) + "\n");
        if (!(await reporter.confirm("Seal this baton?"))) {
            reporter.warn("aborted — nothing sealed");
            return { sealed: false };
        }
    }
    const meta = {
        projectId: config.projectId,
        author: userInfo().username,
        tool,
        captureMode,
        model,
        branch: signal.branch ?? undefined,
        parents: config.head ? [config.head] : [],
        attachments,
    };
    // Grade against the source (best-effort; never blocks the pass).
    let fidelity;
    if (transcriptText && captureMode === "transcript" && process.env.ANTHROPIC_API_KEY) {
        try {
            const draft = finalize(scrubbed, meta).handoff;
            fidelity = await gradeHandoff(new AnthropicClient(), { handoff: draft, transcript: transcriptText });
        }
        catch (err) {
            reporter.warn(`fidelity grading skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    const { handoff, id } = finalize(scrubbed, { ...meta, fidelity });
    if (transcriptText && attachments) {
        for (const attachment of attachments)
            store.saveAttachment(attachment, transcriptText);
    }
    store.saveHandoff(handoff, id);
    store.setHead(id);
    store.saveWorkingState(scrubbed);
    let queued = false;
    try {
        store.enqueueUploadJob(createUploadJob(id, handoff));
        queued = true;
    }
    catch (err) {
        reporter.warn(`baton saved locally, but remote publication was not queued: ${err instanceof Error ? err.message : String(err)}`);
    }
    const lineage = handoff.meta.parents.length ? ` ← ${shortId(handoff.meta.parents[0])}` : "";
    const touched = handoff.repoMap.touched.length;
    const bits = [
        handoff.meta.captureMode === "transcript" ? "transcript" : "fallback",
        touched > 0 ? `${touched} file(s)` : null,
        handoff.fidelity.score !== null ? `fidelity ${(handoff.fidelity.score * 100).toFixed(0)}%` : null,
    ].filter(Boolean);
    reporter.ok(`baton ${shortId(id)} passed${lineage} · ${bits.join(" · ")}${queued ? " · publication queued locally" : ""}`);
    return { sealed: true, id, handoff, queued };
}
export async function runPass(cwd, opts = {}) {
    await passBaton(cwd, opts, CLI_REPORTER);
}
//# sourceMappingURL=pass.js.map