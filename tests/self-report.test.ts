import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySelfReportCheckpoint } from "../src/core/self-report.ts";
import { ProjectStore } from "../src/store/project.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "baton-self-report-test-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("self-report checkpoint replaces latest-truth sections and merges touched files", () => {
  const store = ProjectStore.init(root);
  const result = applySelfReportCheckpoint(store, {
    mission: "ship MCP",
    status: "in-progress",
    decisions: [
      { id: "d1", choice: "stdio", rationale: "local trust boundary" },
      { id: "d1", choice: "duplicate", rationale: "ignored" },
    ],
    graveyard: [{ id: "g1", approach: "HTTP daemon", reason: "unneeded backend" }],
    nextActions: ["test client"],
    touchedFiles: [{ path: "src/mcp/server.ts" }],
  }, new Date("2026-06-19T12:00:00Z"));
  assert.equal(result.state.mission, "ship MCP");
  assert.equal(result.state.decisions.length, 1);
  assert.equal(result.state.graveyard.length, 1);
  assert.equal(result.state.repoMap.touched[0]!.path, "src/mcp/server.ts");
  assert.equal(result.state.checkpointCount, 1);
  assert.deepEqual(store.loadWorkingState(), result.state);
});

test("self-report checkpoint preserves omitted sections and scrubs secrets", () => {
  const store = ProjectStore.init(root);
  applySelfReportCheckpoint(store, { mission: "keep me", nextActions: ["existing"] });
  const result = applySelfReportCheckpoint(store, {
    envNotes: ["token ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ"],
  });
  assert.equal(result.state.mission, "keep me");
  assert.deepEqual(result.state.nextActions, ["existing"]);
  assert.match(result.state.envNotes[0]!, /REDACTED/);
  assert.ok(result.findings.length > 0);
});
