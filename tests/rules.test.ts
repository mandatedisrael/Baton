import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEGIN_MARKER,
  END_MARKER,
  hasRulesContent,
  renderRulesBlock,
  upsertManagedBlock,
  RULES_TARGETS,
} from "../src/render/rules.ts";
import { finalize } from "../src/core/finalize.ts";
import { applyPatches, emptyWorkingState } from "../src/core/working-state.ts";
import type { Handoff } from "../src/schema/handoff.ts";

function handoffWith(ops: Parameters<typeof applyPatches>[1]): Handoff {
  const state = applyPatches(emptyWorkingState(new Date("2026-06-13T00:00:00.000Z")), ops, new Date());
  return finalize(state, {
    projectId: "p",
    author: "a",
    tool: "claude-code",
    captureMode: "fallback",
    parents: [],
    timestamp: "2026-06-13T00:00:00.000Z",
  }).handoff;
}

test("renderRulesBlock includes verbatim rules and env notes", () => {
  const h = handoffWith([
    { kind: "add_verbatim_rule", rule: "never log raw tokens" },
    { kind: "add_verbatim_rule", rule: "use SHA-256 for ids" },
    { kind: "add_env_note", note: "Node >=22.18 required" },
  ]);
  const body = renderRulesBlock(h, "abc123");
  assert.match(body, /managed by BATON — from baton abc123/);
  assert.match(body, /- never log raw tokens/);
  assert.match(body, /- use SHA-256 for ids/);
  assert.match(body, /### Environment/);
  assert.match(body, /- Node >=22\.18 required/);
});

test("renderRulesBlock omits the Environment section when there are no notes", () => {
  const h = handoffWith([{ kind: "add_verbatim_rule", rule: "rule one" }]);
  const body = renderRulesBlock(h, "abc123");
  assert.doesNotMatch(body, /### Environment/);
});

test("hasRulesContent reflects presence of rules or env notes", () => {
  assert.equal(hasRulesContent(handoffWith([])), false);
  assert.equal(hasRulesContent(handoffWith([{ kind: "add_env_note", note: "x" }])), true);
  assert.equal(hasRulesContent(handoffWith([{ kind: "add_verbatim_rule", rule: "y" }])), true);
});

test("upsertManagedBlock writes the block into an empty file", () => {
  const out = upsertManagedBlock("", "BODY");
  assert.equal(out, `${BEGIN_MARKER}\nBODY\n${END_MARKER}\n`);
});

test("upsertManagedBlock appends without disturbing existing content", () => {
  const existing = "# My Project\n\nHand-written guidance.\n";
  const out = upsertManagedBlock(existing, "BODY");
  assert.ok(out.startsWith(existing), "existing content preserved at the top");
  assert.ok(out.includes(`${BEGIN_MARKER}\nBODY\n${END_MARKER}`));
});

test("upsertManagedBlock replaces only the managed region, twice is idempotent", () => {
  const existing = `# Title\n\n${BEGIN_MARKER}\nOLD BODY\n${END_MARKER}\n\n## Footer kept\n`;
  const once = upsertManagedBlock(existing, "NEW BODY");
  assert.ok(once.includes("NEW BODY"));
  assert.ok(!once.includes("OLD BODY"));
  assert.ok(once.includes("# Title"));
  assert.ok(once.includes("## Footer kept"));
  // Re-rendering the same body must not change the file.
  assert.equal(upsertManagedBlock(once, "NEW BODY"), once);
});

test("RULES_TARGETS map the three known formats to conventional filenames", () => {
  assert.equal(RULES_TARGETS["claude-md"].filename, "CLAUDE.md");
  assert.equal(RULES_TARGETS["agents-md"].filename, "AGENTS.md");
  assert.equal(RULES_TARGETS["cursorrules"].filename, ".cursorrules");
});
