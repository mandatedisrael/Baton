import { test } from "node:test";
import assert from "node:assert/strict";
import { renderResumePrompt } from "../src/render/resume.ts";
import { finalize } from "../src/core/finalize.ts";
import { emptyWorkingState, applyPatches } from "../src/core/working-state.ts";
import type { Handoff } from "../src/schema/handoff.ts";
import { shortId } from "../src/core/hash.ts";

function buildHandoff(): { handoff: Handoff; id: string } {
  let state = emptyWorkingState(new Date("2026-06-13T00:00:00.000Z"));
  state = applyPatches(
    state,
    [
      { kind: "set_mission", mission: "Refactor auth to remove the session-token race" },
      { kind: "set_status", status: "in-progress" },
      { kind: "add_decision", decision: { id: "d1", choice: "Use a token queue", rationale: "serializes refresh" } },
      {
        kind: "move_to_graveyard",
        entry: { id: "g1", approach: "Wrapping the middleware twice", reason: "double-wrapped the refresh and deadlocked" },
      },
      { kind: "set_next_actions", actions: ["wire the queue", "add a regression test"] },
      { kind: "add_env_note", note: "Node >=22.18 required" },
      { kind: "add_verbatim_rule", rule: "never log raw tokens" },
      { kind: "touch_files", files: [{ path: "src/auth.ts" }, { path: "src/queue.ts" }] },
    ],
    new Date("2026-06-13T00:00:00.000Z"),
  );
  return finalize(state, {
    projectId: "p1",
    author: "dev",
    tool: "claude-code",
    captureMode: "fallback",
    parents: [],
    timestamp: "2026-06-13T00:00:00.000Z",
  });
}

test("resume prompt includes mission, graveyard, decisions, next actions, files", () => {
  const { handoff, id } = buildHandoff();
  const out = renderResumePrompt(handoff, { chain: [{ shortId: shortId(id), tool: "claude-code" }] });

  assert.match(out, /# Resuming baton /);
  assert.match(out, /Refactor auth to remove the session-token race/);
  assert.match(out, /Graveyard — already tried and FAILED/);
  assert.match(out, /Wrapping the middleware twice/);
  assert.match(out, /Use a token queue/);
  assert.match(out, /1\. wire the queue/);
  assert.match(out, /2\. add a regression test/);
  assert.match(out, /src\/auth\.ts, src\/queue\.ts/);
  assert.match(out, /never log raw tokens/);
});

test("ungraded fallback handoff carries an honest caution footer", () => {
  const { handoff, id } = buildHandoff();
  const out = renderResumePrompt(handoff, { chain: [{ shortId: shortId(id), tool: "claude-code" }] });
  assert.match(out, /fidelity ungraded/);
  assert.match(out, /capture fallback/);
  assert.match(out, /Caution:.*ungraded/);
  assert.match(out, /fallback mode/);
});

test("empty sections are omitted entirely", () => {
  let state = emptyWorkingState(new Date("2026-06-13T00:00:00.000Z"));
  state = applyPatches(state, [{ kind: "set_mission", mission: "just a mission" }], new Date());
  const { handoff, id } = finalize(state, {
    projectId: "p",
    author: "a",
    tool: "other",
    captureMode: "fallback",
    parents: [],
    timestamp: "2026-06-13T00:00:00.000Z",
  });
  const out = renderResumePrompt(handoff, { chain: [{ shortId: shortId(id), tool: "other" }] });
  assert.doesNotMatch(out, /## Graveyard/);
  assert.doesNotMatch(out, /## Decisions/);
  assert.doesNotMatch(out, /## Next actions/);
  assert.doesNotMatch(out, /## Files/);
  assert.match(out, /## Mission\njust a mission/);
});

test("lineage line renders the chain nearest-first with tools", () => {
  const { handoff } = buildHandoff();
  const out = renderResumePrompt(handoff, {
    chain: [
      { shortId: "aaaaaaaaaaaa", tool: "claude-code" },
      { shortId: "bbbbbbbbbbbb", tool: "codex" },
    ],
  });
  assert.match(out, /Lineage: aaaaaaaaaaaa \(claude-code\) ← bbbbbbbbbbbb \(codex\)/);
});

test("receiving-tool intro is tailored when provided", () => {
  const { handoff, id } = buildHandoff();
  const out = renderResumePrompt(handoff, {
    chain: [{ shortId: shortId(id), tool: "claude-code" }],
    receivingTool: "codex",
  });
  assert.match(out, /You are Codex resuming/);
});

test("OpenCode receives its own resume dialect", () => {
  const { handoff, id } = buildHandoff();
  const out = renderResumePrompt(handoff, {
    chain: [{ shortId: shortId(id), tool: "opencode" }],
    receivingTool: "opencode",
  });
  assert.match(out, /You are OpenCode resuming/);
});
