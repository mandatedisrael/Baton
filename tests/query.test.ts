import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finalize } from "../src/core/finalize.ts";
import { listHandoffs, searchHandoffs } from "../src/core/query.ts";
import { ProjectStore } from "../src/store/project.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "baton-query-test-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function save(store: ProjectStore, mission: string, timestamp: string) {
  const state = { ...store.loadWorkingState(), mission };
  const result = finalize(state, {
    projectId: store.config().projectId,
    author: "test",
    tool: "codex",
    captureMode: "fallback",
    parents: [],
    timestamp,
  });
  store.saveHandoff(result.handoff, result.id);
  return result;
}

test("listHandoffs returns verified newest-first entries", () => {
  const store = ProjectStore.init(root);
  const old = save(store, "old mission", "2026-06-19T10:00:00.000Z");
  const recent = save(store, "recent mission", "2026-06-19T11:00:00.000Z");
  assert.deepEqual(listHandoffs(store).map((entry) => entry.id), [recent.id, old.id]);
});

test("searchHandoffs finds structured handoff content with bounded results", () => {
  const store = ProjectStore.init(root);
  save(store, "repair authentication middleware", "2026-06-19T10:00:00.000Z");
  save(store, "unrelated task", "2026-06-19T11:00:00.000Z");
  const results = searchHandoffs(store, "AUTHENTICATION", 10);
  assert.equal(results.length, 1);
  assert.match(results[0]!.mission, /authentication/);
  assert.deepEqual(searchHandoffs(store, "   "), []);
});
