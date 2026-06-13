/**
 * Rules-file renderer (plan §3.1 component 5).
 *
 * Projects a handoff's persistent guidance — `verbatimRules` (content destined
 * for these files) plus environment notes — into the conventional per-tool
 * rules files: CLAUDE.md, AGENTS.md, .cursorrules.
 *
 * Writes are non-destructive: BATON owns only the region between its markers
 * (`upsertManagedBlock`), so a developer's hand-written content in the same
 * file is preserved across re-renders. Pure functions; IO lives in the command.
 */
import type { Handoff } from "../schema/handoff.ts";

export type RulesFormat = "claude-md" | "agents-md" | "cursorrules";

export interface RulesTarget {
  format: RulesFormat;
  filename: string;
}

export const RULES_TARGETS: Record<RulesFormat, RulesTarget> = {
  "claude-md": { format: "claude-md", filename: "CLAUDE.md" },
  "agents-md": { format: "agents-md", filename: "AGENTS.md" },
  cursorrules: { format: "cursorrules", filename: ".cursorrules" },
};

export const BEGIN_MARKER = "<!-- baton:begin -->";
export const END_MARKER = "<!-- baton:end -->";

/** True when the handoff has nothing persistent worth writing to a rules file. */
export function hasRulesContent(handoff: Handoff): boolean {
  return handoff.verbatimRules.length > 0 || handoff.envNotes.length > 0;
}

/** Render the BATON-managed rules block body (without the surrounding markers). */
export function renderRulesBlock(handoff: Handoff, shortId: string): string {
  const lines: string[] = [
    `## Project rules (managed by BATON — from baton ${shortId})`,
    "",
    "Edits inside this block are overwritten on the next `baton render`.",
  ];

  if (handoff.verbatimRules.length > 0) {
    lines.push("", ...handoff.verbatimRules.map((r) => `- ${r}`));
  }

  if (handoff.envNotes.length > 0) {
    lines.push("", "### Environment", ...handoff.envNotes.map((n) => `- ${n}`));
  }

  return lines.join("\n");
}

/**
 * Insert or replace the BATON-managed block in `existing`, preserving every
 * byte outside the markers. Idempotent: rendering twice yields the same file.
 */
export function upsertManagedBlock(existing: string, body: string): string {
  const block = `${BEGIN_MARKER}\n${body}\n${END_MARKER}`;

  const begin = existing.indexOf(BEGIN_MARKER);
  const end = existing.indexOf(END_MARKER);
  if (begin !== -1 && end !== -1 && end > begin) {
    return existing.slice(0, begin) + block + existing.slice(end + END_MARKER.length);
  }

  if (existing.trim() === "") return block + "\n";
  const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return existing + separator + block + "\n";
}
