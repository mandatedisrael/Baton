import type { Handoff } from "../schema/handoff.ts";
import { ProjectStore } from "../store/project.ts";

export interface HandoffEntry {
  id: string;
  handoff: Handoff;
}

export interface HandoffSearchResult {
  id: string;
  timestamp: string;
  tool: string;
  status: string;
  mission: string;
  matches: string[];
}

export function listHandoffs(store: ProjectStore): HandoffEntry[] {
  return store
    .listHandoffIds()
    .map((id) => ({ id, handoff: store.loadHandoff(id) }))
    .sort((a, b) => b.handoff.meta.timestamp.localeCompare(a.handoff.meta.timestamp));
}

function searchableLines(handoff: Handoff): string[] {
  return [
    handoff.mission,
    ...handoff.decisions.flatMap((decision) => [decision.choice, decision.rationale]),
    ...handoff.graveyard.flatMap((entry) => [entry.approach, entry.reason]),
    ...handoff.nextActions,
    ...handoff.envNotes,
    ...handoff.verbatimRules,
    ...handoff.repoMap.touched.map((file) => file.path),
    ...handoff.repoMap.important.map((file) => file.path),
    ...handoff.repoMap.entryPoints,
  ].filter((line) => line !== "");
}

export function searchHandoffs(store: ProjectStore, query: string, limit = 10): HandoffSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [];
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const results: HandoffSearchResult[] = [];
  for (const { id, handoff } of listHandoffs(store)) {
    const matches = searchableLines(handoff)
      .filter((line) => line.toLocaleLowerCase().includes(needle))
      .slice(0, 5);
    if (matches.length === 0) continue;
    results.push({
      id,
      timestamp: handoff.meta.timestamp,
      tool: handoff.meta.tool,
      status: handoff.status,
      mission: handoff.mission,
      matches,
    });
    if (results.length >= boundedLimit) break;
  }
  return results;
}
