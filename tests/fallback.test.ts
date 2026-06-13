import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractCheckboxTodos,
  fallbackPatchOps,
  gatherFallbackSignal,
  parseGitStatusPorcelain,
  type FallbackSignal,
} from "../src/distiller/fallback.ts";

test("parseGitStatusPorcelain extracts paths incl. renames and untracked", () => {
  const out = [
    " M src/core/finalize.ts",
    "?? src/cli/",
    "A  src/store/project.ts",
    "R  old/name.ts -> new/name.ts",
    "",
  ].join("\n");
  assert.deepEqual(parseGitStatusPorcelain(out), [
    "src/core/finalize.ts",
    "src/cli/",
    "src/store/project.ts",
    "new/name.ts",
  ]);
});

test("parseGitStatusPorcelain unquotes paths with special characters", () => {
  const out = ' M "src/with space.ts"\n';
  assert.deepEqual(parseGitStatusPorcelain(out), ["src/with space.ts"]);
});

test("extractCheckboxTodos returns only unchecked items, capped", () => {
  const md = [
    "# Plan",
    "- [ ] wire the distiller",
    "- [x] ship the schema",
    "* [ ] add the grader",
    "- [ ]   trailing spaces trimmed   ",
    "not a checkbox",
  ].join("\n");
  assert.deepEqual(extractCheckboxTodos(md), [
    "wire the distiller",
    "add the grader",
    "trailing spaces trimmed",
  ]);
  assert.equal(extractCheckboxTodos(md, 1).length, 1);
});

test("fallbackPatchOps emits ops only for non-empty signal fields", () => {
  const signal: FallbackSignal = {
    branch: "main",
    touched: [{ path: "a.ts", contentHash: "deadbeef" }],
    nextActions: ["do the thing"],
    envNotes: ["note one", "note two"],
  };
  const ops = fallbackPatchOps(signal);
  assert.deepEqual(ops, [
    { kind: "touch_files", files: [{ path: "a.ts", contentHash: "deadbeef" }] },
    { kind: "set_next_actions", actions: ["do the thing"] },
    { kind: "add_env_note", note: "note one" },
    { kind: "add_env_note", note: "note two" },
  ]);
});

test("fallbackPatchOps on an empty signal emits nothing", () => {
  assert.deepEqual(
    fallbackPatchOps({ branch: null, touched: [], nextActions: [], envNotes: [] }),
    [],
  );
});

test("gatherFallbackSignal degrades gracefully outside a git repo", () => {
  // os tmpdir is not a git repo; must return an empty-ish signal, not throw.
  const tmp = process.env.TMPDIR ?? "/tmp";
  const signal = gatherFallbackSignal(tmp);
  assert.equal(signal.branch, null);
  assert.ok(Array.isArray(signal.touched));
  assert.ok(signal.envNotes.length >= 1);
});

test("gatherFallbackSignal reads this repo's branch and touched files", () => {
  // Run inside the baton repo itself — there is always a branch.
  const signal = gatherFallbackSignal(process.cwd());
  assert.ok(typeof signal.branch === "string" && signal.branch.length > 0);
  for (const f of signal.touched) assert.ok(typeof f.path === "string" && f.path.length > 0);
});
