import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCitationSpan, findCitedClaim, renderCitationEvidence } from "../src/core/citations.ts";
import { finalize } from "../src/core/finalize.ts";
import { applyPatches, emptyWorkingState } from "../src/core/working-state.ts";

function citedHandoff() {
  const citation = { attachmentId: "transcript-1", fromLine: 2, toLine: 3 };
  const state = applyPatches(emptyWorkingState(new Date("2026-06-19T00:00:00Z")), [
    {
      kind: "add_decision",
      decision: { id: "d1", choice: "use a queue", rationale: "serialize work", citation },
    },
    {
      kind: "move_to_graveyard",
      entry: { id: "g1", approach: "use polling", reason: "too slow", citation },
    },
  ]);
  return finalize(state, {
    projectId: "project-1",
    author: "test",
    tool: "claude-code",
    captureMode: "transcript",
    parents: [],
    timestamp: "2026-06-19T00:00:00.000Z",
  }).handoff;
}

test("findCitedClaim resolves decisions and graveyard entries", () => {
  const handoff = citedHandoff();
  assert.equal(findCitedClaim(handoff, "d1").kind, "decision");
  assert.equal(findCitedClaim(handoff, "g1").kind, "graveyard");
  assert.throws(() => findCitedClaim(handoff, "missing"), /no decision or graveyard/);
});

test("findCitedClaim refuses an uncited claim", () => {
  const handoff = citedHandoff();
  handoff.decisions[0] = { id: "d1", choice: "use a queue", rationale: "" };
  assert.throws(() => findCitedClaim(handoff, "d1"), /has no source citation/);
});

test("extractCitationSpan returns the exact inclusive source lines", () => {
  const lines = extractCitationSpan("one\ntwo\nthree\nfour\n", {
    attachmentId: "transcript-1",
    fromLine: 2,
    toLine: 3,
  });
  assert.deepEqual(lines, ["two", "three"]);
});

test("extractCitationSpan rejects spans outside the attachment", () => {
  assert.throws(
    () => extractCitationSpan("one\ntwo\n", { attachmentId: "a", fromLine: 2, toLine: 3 }),
    /fall outside attachment/,
  );
});

test("renderCitationEvidence includes line numbers and verification status", () => {
  const claim = findCitedClaim(citedHandoff(), "d1");
  const rendered = renderCitationEvidence(claim, ["two", "three"]);
  assert.match(rendered, /decision d1: use a queue/);
  assert.match(rendered, /lines 2-3 \(verified\)/);
  assert.match(rendered, /2: two\n3: three/);
});
