import { userInfo } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { finalize } from "../../core/finalize.ts";
import { shortId } from "../../core/hash.ts";
import { applyPatches, type WorkingState } from "../../core/working-state.ts";
import { ProjectStore } from "../../store/project.ts";
import type { Attachment, CaptureMode, Fidelity, ToolId } from "../../schema/handoff.ts";
import { fallbackPatchOps, gatherFallbackSignal } from "../../distiller/fallback.ts";
import { scrubDeep } from "../../distiller/scrub.ts";
import { parseClaudeCodeTranscript } from "../../distiller/capture/claude-code.ts";
import { transcriptAttachment } from "../../distiller/capture/transcript.ts";
import { transcriptAttachmentId } from "../../distiller/checkpoint.ts";
import { gradeHandoff } from "../../distiller/grade.ts";
import { AnthropicClient } from "../../llm/anthropic.ts";
import { renderReview } from "../../render/review.ts";
import { confirm, ok, warn } from "../output.ts";

export interface PassOptions {
  /** Show the distillation + change summary and require confirmation before sealing. */
  review?: boolean;
}

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
export async function runPass(cwd: string, opts: PassOptions = {}): Promise<void> {
  const store = ProjectStore.open(cwd);
  const config = store.config();
  const state = store.loadWorkingState();
  const cursor = store.loadCursor();

  // Locate the source transcript (if checkpoints recorded one).
  let attachments: Attachment[] | undefined;
  let transcriptText: string | undefined;
  let tool: ToolId = "other";
  let captureMode: CaptureMode = "fallback";
  let model: string | undefined;
  if (cursor.transcriptPath && existsSync(cursor.transcriptPath)) {
    try {
      transcriptText = readFileSync(cursor.transcriptPath, "utf8");
      const session = parseClaudeCodeTranscript(transcriptText);
      const attId = transcriptAttachmentId(session);
      if (attId) {
        attachments = [transcriptAttachment(session, attId)];
        tool = "claude-code";
        captureMode = "transcript";
        model = session.model ?? undefined;
      }
    } catch {
      transcriptText = undefined; // unreadable transcript → fall back cleanly
    }
  }

  // Enrich empty fields from the working tree — never clobber checkpoint data.
  const signal = gatherFallbackSignal(store.root);
  const enriched = applyPatches(
    state,
    fallbackPatchOps({
      branch: signal.branch,
      touched: state.repoMap.touched.length === 0 ? signal.touched : [],
      nextActions: state.nextActions.length === 0 ? signal.nextActions : [],
      envNotes: state.envNotes.length === 0 ? signal.envNotes : [],
    }),
  );

  // Scrub before anything is sealed or re-saved locally.
  const { value, findings } = scrubDeep(enriched);
  const scrubbed = value as WorkingState;
  if (findings.length > 0) {
    warn(`scrubbed secrets before sealing: ${findings.map((f) => `${f.count}× ${f.type}`).join(", ")}`);
  }

  if (
    scrubbed.mission === "" &&
    scrubbed.decisions.length === 0 &&
    scrubbed.graveyard.length === 0 &&
    scrubbed.repoMap.touched.length === 0
  ) {
    warn("nothing to capture — clean working tree and empty state; passing an empty baton");
  }

  // Review gate: show what's about to be sealed and require confirmation.
  if (opts.review) {
    const parent = config.head ? { id: config.head, handoff: store.loadHandoff(config.head) } : null;
    process.stdout.write("\n" + renderReview(scrubbed, { tool, captureMode, parent }) + "\n");
    if (!(await confirm("Seal this baton?"))) {
      warn("aborted — nothing sealed");
      return;
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
  let fidelity: Fidelity | undefined;
  if (transcriptText && captureMode === "transcript" && process.env.ANTHROPIC_API_KEY) {
    try {
      const draft = finalize(scrubbed, meta).handoff;
      fidelity = await gradeHandoff(new AnthropicClient(), { handoff: draft, transcript: transcriptText });
    } catch (err) {
      warn(`fidelity grading skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const { handoff, id } = finalize(scrubbed, { ...meta, fidelity });
  store.saveHandoff(handoff, id);
  store.setHead(id);
  store.saveWorkingState(scrubbed);

  const lineage = handoff.meta.parents.length ? ` ← ${shortId(handoff.meta.parents[0]!)}` : "";
  const touched = handoff.repoMap.touched.length;
  const bits = [
    handoff.meta.captureMode === "transcript" ? "transcript" : "fallback",
    touched > 0 ? `${touched} file(s)` : null,
    handoff.fidelity.score !== null ? `fidelity ${(handoff.fidelity.score * 100).toFixed(0)}%` : null,
  ].filter(Boolean);
  ok(`baton ${shortId(id)} passed${lineage} · ${bits.join(" · ")} (local-only; anchoring lands in phase 3)`);
}
