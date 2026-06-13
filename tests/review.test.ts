import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReview } from "../src/render/review.ts";
import { finalize } from "../src/core/finalize.ts";
import { applyPatches, emptyWorkingState, type WorkingState } from "../src/core/working-state.ts";
import { shortId } from "../src/core/hash.ts";
import type { Handoff } from "../src/schema/handoff.ts";

function build(ops: Parameters<typeof applyPatches>[1]): WorkingState {
  return applyPatches(emptyWorkingState(new Date("2026-06-13T00:00:00Z")), ops);
}

function seal(state: WorkingState): { id: string; handoff: Handoff } {
  return finalize(state, {
    projectId: "p",
    author: "a",
    tool: "claude-code",
    captureMode: "transcript",
    parents: [],
    timestamp: "2026-06-13T00:00:00.000Z",
  });
}

test("review shows the distilled content", () => {
  const state = build([
    { kind: "set_mission", mission: "fix the auth race" },
    { kind: "set_status", status: "in-progress" },
    { kind: "add_decision", decision: { id: "d1", choice: "use a queue", rationale: "serializes refresh" } },
    { kind: "move_to_graveyard", entry: { id: "g1", approach: "double middleware", reason: "deadlocked" } },
    { kind: "set_next_actions", actions: ["wire the queue"] },
    { kind: "touch_files", files: [{ path: "src/auth.ts" }] },
  ]);
  const out = renderReview(state, { tool: "claude-code", captureMode: "transcript", parent: null });

  assert.match(out, /About to seal a baton/);
  assert.match(out, /fix the auth race/);
  assert.match(out, /use a queue — serializes refresh/);
  assert.match(out, /graveyard \(1\) — tried and failed/);
  assert.match(out, /double middleware — deadlocked/);
  assert.match(out, /1\. wire the queue/);
  assert.match(out, /src\/auth\.ts/);
  assert.match(out, /first baton in this project/);
});

test("review summarizes changes against the parent baton", () => {
  const parentState = build([
    { kind: "set_mission", mission: "fix the auth race" },
    { kind: "set_status", status: "in-progress" },
    { kind: "add_decision", decision: { id: "d1", choice: "use a queue", rationale: "" } },
  ]);
  const parent = seal(parentState);

  const nextState = build([
    { kind: "set_mission", mission: "fix the auth race" },
    { kind: "set_status", status: "blocked" },
    { kind: "add_decision", decision: { id: "d1", choice: "use a queue", rationale: "" } },
    { kind: "add_decision", decision: { id: "d2", choice: "add a test", rationale: "" } },
    { kind: "move_to_graveyard", entry: { id: "g1", approach: "redis", reason: "pool" } },
  ]);

  const out = renderReview(nextState, { tool: "claude-code", captureMode: "transcript", parent });
  assert.match(out, new RegExp(`since baton ${shortId(parent.id)}`));
  assert.match(out, /status in-progress → blocked/);
  assert.match(out, /\+1 decision\(s\)/); // d2 is new; d1 carried over
  assert.match(out, /\+1 graveyard entry/);
});

test("review reports no distilled changes when nothing changed", () => {
  const state = build([{ kind: "set_mission", mission: "same" }, { kind: "set_status", status: "in-progress" }]);
  const parent = seal(state);
  const out = renderReview(state, { tool: "claude-code", captureMode: "transcript", parent });
  assert.match(out, /no distilled changes/);
});
