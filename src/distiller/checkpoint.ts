/**
 * Micro-checkpoint orchestration (plan §3.3 step 1, the loop).
 *
 * `sliceDelta` is the pure heart: given a freshly captured session and where the
 * distiller last left off, it returns only the new turns plus the advanced
 * cursor. A new session (different id) re-reads from the top; the same session
 * yields only turns past the cursor line. Lines are append-only in a transcript,
 * so the cursor is monotonic and citations made early stay valid later.
 *
 * `runCheckpoint` (the IO step) wires capture → slice → extract → apply, and is
 * invoked by the Claude Code Stop hook. It is built to never disrupt the host
 * session: any failure is swallowed (the CLI command exits 0 regardless).
 */
import type { CapturedSession, CaptureMessage } from "./capture/transcript.ts";
import type { CheckpointCursor } from "../store/project.ts";

export interface DeltaResult {
  delta: CaptureMessage[];
  cursor: CheckpointCursor;
}

/** The new turns since `prev`, plus the advanced cursor. Pure. */
export function sliceDelta(session: CapturedSession, prev: CheckpointCursor): DeltaResult {
  const sameSession = session.sessionId !== null && session.sessionId === prev.sessionId;
  const fromLine = sameSession ? prev.line : 0;
  const delta = session.messages.filter((m) => m.line > fromLine);
  const line = session.messages.reduce((mx, m) => Math.max(mx, m.line), fromLine);
  return { delta, cursor: { sessionId: session.sessionId, line } };
}

/**
 * The stable attachment id for a session's transcript. Derived from the session
 * id (not the content hash, which changes as the transcript grows), so a
 * citation minted during an early checkpoint still resolves to the attachment
 * that `pass` eventually seals.
 */
export function transcriptAttachmentId(session: CapturedSession): string | undefined {
  return session.sessionId ? `transcript-${session.sessionId}` : undefined;
}
