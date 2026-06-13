import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyPatch,
  applyPatches,
  emptyWorkingState,
  type PatchOp,
} from "../src/core/working-state.ts";

const now = new Date("2026-06-13T12:00:00.000Z");

describe("working state patch ops", () => {
  it("starts empty and well-formed", () => {
    const s = emptyWorkingState(now);
    assert.equal(s.mission, "");
    assert.equal(s.status, "in-progress");
    assert.equal(s.checkpointCount, 0);
  });

  it("set_mission / set_status", () => {
    let s = emptyWorkingState(now);
    s = applyPatch(s, { kind: "set_mission", mission: "fix auth" }, now);
    s = applyPatch(s, { kind: "set_status", status: "blocked" }, now);
    assert.equal(s.mission, "fix auth");
    assert.equal(s.status, "blocked");
    assert.equal(s.checkpointCount, 2);
  });

  it("does not mutate the input state", () => {
    const s0 = emptyWorkingState(now);
    applyPatch(s0, { kind: "set_mission", mission: "x" }, now);
    assert.equal(s0.mission, "");
  });

  it("add_decision then update_decision — latest truth wins", () => {
    let s = emptyWorkingState(now);
    s = applyPatch(
      s,
      { kind: "add_decision", decision: { id: "d1", choice: "use redis", rationale: "fast" } },
      now,
    );
    s = applyPatch(s, { kind: "update_decision", id: "d1", patch: { choice: "use SSE" } }, now);
    assert.equal(s.decisions.length, 1);
    assert.equal(s.decisions[0]!.choice, "use SSE");
    assert.equal(s.decisions[0]!.rationale, "fast");
  });

  it("update_decision on unknown id is a no-op (no bookkeeping bump)", () => {
    const s0 = emptyWorkingState(now);
    const s1 = applyPatch(s0, { kind: "update_decision", id: "ghost", patch: { choice: "x" } }, now);
    assert.equal(s1, s0);
  });

  it("move_to_graveyard removes the decision and records the failure", () => {
    let s = emptyWorkingState(now);
    s = applyPatch(
      s,
      { kind: "add_decision", decision: { id: "d1", choice: "redis pub/sub", rationale: "" } },
      now,
    );
    s = applyPatch(
      s,
      {
        kind: "move_to_graveyard",
        decisionId: "d1",
        entry: { id: "g1", approach: "redis pub/sub", reason: "connection pooling" },
      },
      now,
    );
    assert.equal(s.decisions.length, 0);
    assert.equal(s.graveyard.length, 1);
    assert.equal(s.graveyard[0]!.reason, "connection pooling");
  });

  it("move_to_graveyard without decisionId records a fresh failure", () => {
    const s = applyPatch(
      emptyWorkingState(now),
      { kind: "move_to_graveyard", entry: { id: "g1", approach: "x", reason: "y" } },
      now,
    );
    assert.equal(s.graveyard.length, 1);
  });

  it("set_next_actions replaces wholesale (latest truth wins)", () => {
    let s = emptyWorkingState(now);
    s = applyPatch(s, { kind: "set_next_actions", actions: ["a", "b"] }, now);
    s = applyPatch(s, { kind: "set_next_actions", actions: ["c"] }, now);
    assert.deepEqual(s.nextActions, ["c"]);
  });

  it("touch_files merges by path, latest wins", () => {
    let s = emptyWorkingState(now);
    s = applyPatch(s, { kind: "touch_files", files: [{ path: "a.ts", contentHash: "1" }] }, now);
    s = applyPatch(
      s,
      {
        kind: "touch_files",
        files: [
          { path: "a.ts", contentHash: "2" },
          { path: "b.ts", contentHash: "3" },
        ],
      },
      now,
    );
    assert.equal(s.repoMap.touched.length, 2);
    assert.equal(s.repoMap.touched.find((f) => f.path === "a.ts")!.contentHash, "2");
  });

  it("noop changes nothing, including bookkeeping", () => {
    const s0 = emptyWorkingState(now);
    assert.equal(applyPatch(s0, { kind: "noop", reason: "nothing new" }, now), s0);
  });

  it("applyPatches runs a checkpoint batch in order", () => {
    const ops: PatchOp[] = [
      { kind: "set_mission", mission: "m" },
      { kind: "add_env_note", note: "node 22" },
      { kind: "add_verbatim_rule", rule: "no .env commits" },
      { kind: "noop" },
    ];
    const s = applyPatches(emptyWorkingState(now), ops, now);
    assert.equal(s.mission, "m");
    assert.deepEqual(s.envNotes, ["node 22"]);
    assert.deepEqual(s.verbatimRules, ["no .env commits"]);
    assert.equal(s.checkpointCount, 3); // noop excluded
  });
});
