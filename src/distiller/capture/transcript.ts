/**
 * Capture types — the normalized shape every capture adapter produces.
 *
 * A capture adapter turns a tool-specific session record (Claude Code JSONL,
 * Codex session files, ...) into a `CapturedSession`: an ordered list of
 * messages, each tagged with its 1-based line number in the source. That line
 * number is the citation addressing unit (schema `Citation.fromLine/toLine`) —
 * the raw transcript is stored as an attachment, and every distilled claim
 * cites the line span it came from. Adapters are pure: bytes in, struct out.
 */
import type { Attachment, ToolId } from "../../schema/handoff.ts";

export type Role = "user" | "assistant" | "system";

export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  toolUseId: string;
  text: string;
  isError: boolean;
}

export interface CaptureMessage {
  /** 1-based line number in the source transcript — the citation unit. */
  line: number;
  role: Role;
  uuid: string | null;
  parentUuid: string | null;
  /** True for messages from a sub-agent sidechain, not the main thread. */
  isSidechain: boolean;
  /** True for tool-injected meta messages (reminders, etc.), not real user input. */
  isMeta: boolean;
  timestamp: string | null;
  /** Visible text (excludes extended thinking). */
  text: string;
  /** Assistant extended thinking, if any. */
  thinking: string;
  toolUses: ToolUse[];
  toolResults: ToolResult[];
}

export interface CapturedSession {
  tool: ToolId;
  sessionId: string | null;
  /** Most recent assistant model id observed in the session. */
  model: string | null;
  cwd: string | null;
  gitBranch: string | null;
  messages: CaptureMessage[];
  /** Stats of the raw transcript bytes — feed the Attachment record. */
  raw: {
    bytes: number;
    /** SHA-256 of the raw transcript text (what verify recomputes). */
    hash: string;
    /** Total lines in the source (excludes a single trailing newline). */
    lineCount: number;
  };
}

/** Build the schema Attachment that travels alongside a handoff for this session. */
export function transcriptAttachment(session: CapturedSession, id: string): Attachment {
  return {
    id,
    kind: "transcript",
    contentHash: session.raw.hash,
    bytes: session.raw.bytes,
    blobRef: null, // assigned on Walrus upload (phase 3)
  };
}
