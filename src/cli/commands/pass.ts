import { userInfo } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { finalize } from "../../core/finalize.ts";
import { shortId } from "../../core/hash.ts";
import { applyPatches, type WorkingState } from "../../core/working-state.ts";
import { ProjectStore } from "../../store/project.ts";
import type { Attachment, CaptureMode, Fidelity, Handoff, ToolId } from "../../schema/handoff.ts";
import { fallbackPatchOps, gatherFallbackSignal } from "../../distiller/fallback.ts";
import { scrub, scrubDeep, type ScrubFinding } from "../../distiller/scrub.ts";
import { parseClaudeCodeTranscript } from "../../distiller/capture/claude-code.ts";
import { findLatestCodexSession, parseCodexTranscript } from "../../distiller/capture/codex.ts";
import { transcriptAttachment } from "../../distiller/capture/transcript.ts";
import { transcriptAttachmentId } from "../../distiller/checkpoint.ts";
import { gradeHandoff } from "../../distiller/grade.ts";
import { AnthropicClient } from "../../llm/anthropic.ts";
import { renderReview } from "../../render/review.ts";
import { confirm, ok, warn } from "../output.ts";
import { createUploadJob } from "../../chain/queue.ts";

export interface PassOptions {
  /** Show the distillation + change summary and require confirmation before sealing. */
  review?: boolean;
  /** Override Codex session discovery for tests or managed installations. */
  codexSessionsRoot?: string;
}

export interface PassReporter {
  warn(message: string): void;
  ok(message: string): void;
  write(message: string): void;
  confirm(question: string): Promise<boolean>;
}

export interface PassResult {
  sealed: boolean;
  id?: string;
  handoff?: Handoff;
  queued?: boolean;
}

const CLI_REPORTER: PassReporter = {
  warn,
  ok,
  write: (message) => process.stdout.write(message),
  confirm,
};

/**
 * `baton pass` — seal the current WorkingState into a handoff (commit).
 *
 * Claude Code supplies its transcript path through the checkpoint cursor.
 * When that is absent, Baton discovers the newest Codex rollout for this exact
 * project cwd. The scrubbed source travels as an attachment and, with
 * ANTHROPIC_API_KEY, grades the structured handoff against the source.
 */
export async function passBaton(
  cwd: string,
  opts: PassOptions = {},
  reporter: PassReporter = CLI_REPORTER,
): Promise<PassResult> {
  const store = ProjectStore.open(cwd);
  const config = store.config();
  const state = store.loadWorkingState();
  const cursor = store.loadCursor();

  // Prefer the explicitly checkpointed Claude transcript, then discover the
  // latest Codex rollout scoped to this exact project root.
  let attachments: Attachment[] | undefined;
  let transcriptText: string | undefined;
  let transcriptFindings: ScrubFinding[] = [];
  let tool: ToolId = "other";
  let captureMode: CaptureMode = "fallback";
  let model: string | undefined;
  const codexPath = cursor.transcriptPath
    ? null
    : findLatestCodexSession(store.root, opts.codexSessionsRoot);
  const transcriptPath = cursor.transcriptPath && existsSync(cursor.transcriptPath)
    ? cursor.transcriptPath
    : codexPath;
  if (transcriptPath) {
    try {
      const scrubbedTranscript = scrub(readFileSync(transcriptPath, "utf8"));
      transcriptText = scrubbedTranscript.clean;
      transcriptFindings = scrubbedTranscript.findings;
      const session = transcriptPath === cursor.transcriptPath
        ? parseClaudeCodeTranscript(transcriptText)
        : parseCodexTranscript(transcriptText);
      const attId = transcriptAttachmentId(session);
      if (attId) {
        attachments = [transcriptAttachment(session, attId)];
        tool = session.tool;
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
  const { value, findings: stateFindings } = scrubDeep(enriched);
  const scrubbed = value as WorkingState;
  const findings = [...stateFindings, ...transcriptFindings];
  if (findings.length > 0) {
    reporter.warn(`scrubbed secrets before sealing: ${findings.map((f) => `${f.count}× ${f.type}`).join(", ")}`);
  }

  if (
    scrubbed.mission === "" &&
    scrubbed.decisions.length === 0 &&
    scrubbed.graveyard.length === 0 &&
    scrubbed.repoMap.touched.length === 0 &&
    !transcriptText
  ) {
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
  let fidelity: Fidelity | undefined;
  if (transcriptText && captureMode === "transcript" && process.env.ANTHROPIC_API_KEY) {
    try {
      const draft = finalize(scrubbed, meta).handoff;
      fidelity = await gradeHandoff(new AnthropicClient(), { handoff: draft, transcript: transcriptText });
    } catch (err) {
      reporter.warn(`fidelity grading skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const { handoff, id } = finalize(scrubbed, { ...meta, fidelity });
  if (transcriptText && attachments) {
    for (const attachment of attachments) store.saveAttachment(attachment, transcriptText);
  }
  store.saveHandoff(handoff, id);
  store.setHead(id);
  store.saveWorkingState(scrubbed);

  let queued = false;
  try {
    store.enqueueUploadJob(createUploadJob(id, handoff));
    queued = true;
  } catch (err) {
    reporter.warn(`baton saved locally, but remote publication was not queued: ${err instanceof Error ? err.message : String(err)}`);
  }

  const lineage = handoff.meta.parents.length ? ` ← ${shortId(handoff.meta.parents[0]!)}` : "";
  const touched = handoff.repoMap.touched.length;
  const bits = [
    handoff.meta.captureMode === "transcript" ? "transcript" : "fallback",
    touched > 0 ? `${touched} file(s)` : null,
    handoff.fidelity.score !== null ? `fidelity ${(handoff.fidelity.score * 100).toFixed(0)}%` : null,
  ].filter(Boolean);
  reporter.ok(`baton ${shortId(id)} passed${lineage} · ${bits.join(" · ")}${queued ? " · publication queued locally" : ""}`);
  return { sealed: true, id, handoff, queued };
}

export async function runPass(cwd: string, opts: PassOptions = {}): Promise<void> {
  await passBaton(cwd, opts, CLI_REPORTER);
}
