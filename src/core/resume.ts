import { shortId } from "./hash.ts";
import { renderResumePrompt, type LineageNode } from "../render/resume.ts";
import type { Handoff, ToolId } from "../schema/handoff.ts";
import { ProjectStore } from "../store/project.ts";

const MAX_LINEAGE = 8;

export function buildResumePrompt(
  store: ProjectStore,
  id: string,
  handoff: Handoff,
  receivingTool?: ToolId,
): string {
  const chain: LineageNode[] = [{ shortId: shortId(id), tool: handoff.meta.tool }];
  const seen = new Set<string>([id]);
  let cursor: string | undefined = handoff.meta.parents[0];
  while (cursor && !seen.has(cursor) && chain.length < MAX_LINEAGE) {
    seen.add(cursor);
    let parent;
    try {
      parent = store.loadHandoff(cursor);
    } catch {
      break;
    }
    chain.push({ shortId: shortId(cursor), tool: parent.meta.tool });
    cursor = parent.meta.parents[0];
  }
  return renderResumePrompt(handoff, { chain, receivingTool });
}
