import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { finalize, type FinalizeMeta } from "../src/core/finalize.ts";
import { hashCanonical } from "../src/core/hash.ts";
import { applyPatches, emptyWorkingState } from "../src/core/working-state.ts";

const now = new Date("2026-06-13T12:00:00.000Z");

const meta: FinalizeMeta = {
  projectId: "p-1",
  author: "dare",
  tool: "claude-code",
  captureMode: "fallback",
  parents: [],
  timestamp: now.toISOString(),
};

function populatedState() {
  return applyPatches(
    emptyWorkingState(now),
    [
      { kind: "set_mission", mission: "ship phase 1" },
      {
        kind: "add_decision",
        decision: { id: "d1", choice: "content-addressed ids", rationale: "like git" },
      },
      { kind: "set_next_actions", actions: ["build distiller"] },
    ],
    now,
  );
}

describe("finalize (pass = commit)", () => {
  it("produces a valid handoff whose id is its canonical hash", () => {
    const { handoff, id } = finalize(populatedState(), meta);
    assert.equal(id, hashCanonical(handoff));
    assert.equal(handoff.mission, "ship phase 1");
    assert.equal(handoff.decisions.length, 1);
    assert.equal(handoff.fidelity.score, null);
  });

  it("is deterministic given a fixed timestamp", () => {
    const a = finalize(populatedState(), meta);
    const b = finalize(populatedState(), meta);
    assert.equal(a.id, b.id);
  });

  it("id changes when state changes", () => {
    const a = finalize(populatedState(), meta);
    const s2 = applyPatches(populatedState(), [{ kind: "set_status", status: "blocked" }], now);
    const b = finalize(s2, meta);
    assert.notEqual(a.id, b.id);
  });

  it("threads parents into meta (lineage)", () => {
    const { handoff } = finalize(populatedState(), { ...meta, parents: ["abc", "def"] });
    assert.deepEqual(handoff.meta.parents, ["abc", "def"]);
  });

  it("an empty state still finalizes (degraded but valid)", () => {
    const { handoff } = finalize(emptyWorkingState(now), meta);
    assert.equal(handoff.mission, "");
    assert.equal(handoff.status, "in-progress");
  });
});
