/**
 * `baton checkpoint` — the Claude Code Stop-hook handler.
 *
 * Claude Code invokes this at the end of each agent turn, passing a JSON event
 * on stdin that includes `transcript_path`. We distill the new turns into the
 * rolling working state. This runs inside the user's live session, so the
 * contract is: NEVER disrupt it — every failure is swallowed and we exit 0.
 *
 * Without ANTHROPIC_API_KEY there is no model to distill with, so we no-op and
 * leave the cursor untouched — the backlog is distilled once a key is set.
 * `baton pass` still produces a useful fallback baton from the git tree either way.
 */
import { applyPatches } from "../../core/working-state.js";
import { ProjectStore } from "../../store/project.js";
import { findProjectRoot } from "../../store/paths.js";
import { captureClaudeCodeFile } from "../../distiller/capture/claude-code.js";
import { sliceDelta, transcriptAttachmentId } from "../../distiller/checkpoint.js";
import { extractCheckpoint } from "../../distiller/extract.js";
import { AnthropicClient } from "../../llm/anthropic.js";
function debug(msg) {
    if (process.env.BATON_DEBUG)
        process.stderr.write(`baton checkpoint: ${msg}\n`);
}
async function readStdin() {
    if (process.stdin.isTTY)
        return "";
    const chunks = [];
    try {
        for await (const chunk of process.stdin)
            chunks.push(chunk);
    }
    catch {
        return "";
    }
    return Buffer.concat(chunks).toString("utf8");
}
/**
 * Runs the checkpoint. Resolves (never rejects) so the caller can exit 0
 * unconditionally — a checkpoint must never block the host agent session.
 */
export async function runCheckpoint() {
    try {
        const raw = await readStdin();
        let event = {};
        if (raw.trim() !== "") {
            try {
                event = JSON.parse(raw);
            }
            catch {
                debug("could not parse hook event JSON");
            }
        }
        const transcriptPath = event.transcript_path;
        if (!transcriptPath)
            return debug("no transcript_path in event");
        const root = findProjectRoot(event.cwd ?? process.cwd());
        if (root === null)
            return debug("not inside a baton project");
        const store = ProjectStore.open(root);
        const prev = store.loadCursor();
        const session = captureClaudeCodeFile(transcriptPath);
        const { delta, cursor } = sliceDelta(session, prev);
        const sameSession = session.sessionId !== null && session.sessionId === prev.sessionId;
        const heldLine = sameSession ? prev.line : 0; // not-yet-distilled position
        // Record the transcript path on every path so `pass` can attach the source.
        if (delta.length === 0) {
            store.saveCursor({ ...cursor, transcriptPath });
            return debug("no new turns since last checkpoint");
        }
        if (!process.env.ANTHROPIC_API_KEY) {
            store.saveCursor({ sessionId: session.sessionId, line: heldLine, transcriptPath });
            return debug("ANTHROPIC_API_KEY not set — skipping distillation (cursor left for later)");
        }
        const ops = await extractCheckpoint(new AnthropicClient(), {
            delta,
            state: store.loadWorkingState(),
            transcriptLineCount: session.raw.lineCount,
            attachmentId: transcriptAttachmentId(session),
        });
        if (ops.length > 0)
            store.saveWorkingState(applyPatches(store.loadWorkingState(), ops));
        store.saveCursor({ ...cursor, transcriptPath }); // advance only after a successful distillation
        debug(`applied ${ops.length} op(s); cursor → line ${cursor.line}`);
    }
    catch (err) {
        debug(err instanceof Error ? err.message : String(err)); // swallow — never disrupt the session
    }
}
//# sourceMappingURL=checkpoint.js.map