import { shortId } from "../../core/hash.ts";
import { ProjectStore } from "../../store/project.ts";
import { renderResumePrompt, type LineageNode } from "../../render/resume.ts";
import type { ToolId } from "../../schema/handoff.ts";
import { resolveHandoffId } from "../resolve.ts";

const MAX_LINEAGE = 8;

/**
 * `baton resume [id]` — render the resume prompt for a verified handoff.
 *
 * Walks the first-parent lineage so the receiving agent sees where this baton
 * came from. Output goes to stdout for piping/injection; the MCP server
 * (phase 4) will inject the same rendering directly into the tool.
 */
export function runResume(cwd: string, idPrefix?: string, receivingTool?: ToolId): void {
  const store = ProjectStore.open(cwd);
  const id = resolveHandoffId(store, idPrefix);
  const handoff = store.loadHandoff(id); // verifies the hash before we render it

  // First-parent chain, nearest first, starting with this handoff.
  const chain: LineageNode[] = [{ shortId: shortId(id), tool: handoff.meta.tool }];
  const seen = new Set<string>([id]);
  let cursor: string | undefined = handoff.meta.parents[0];
  while (cursor && !seen.has(cursor) && chain.length < MAX_LINEAGE) {
    seen.add(cursor);
    let parent;
    try {
      parent = store.loadHandoff(cursor);
    } catch {
      break; // a missing/old parent shouldn't block a resume
    }
    chain.push({ shortId: shortId(cursor), tool: parent.meta.tool });
    cursor = parent.meta.parents[0];
  }

  process.stdout.write(renderResumePrompt(handoff, { chain, receivingTool }));
}
