import { test } from "node:test";
import assert from "node:assert/strict";
import { removeCheckpointHook, upsertCheckpointHook } from "../src/cli/hooks.ts";

const CMD = '"/usr/bin/node" "/abs/baton/src/cli/index.ts" checkpoint';

test("installs the Stop hook into an empty settings object", () => {
  const { settings, status } = upsertCheckpointHook({}, CMD);
  assert.equal(status, "installed");
  assert.deepEqual(settings, { hooks: { Stop: [{ hooks: [{ type: "command", command: CMD }] }] } });
});

test("re-installing the same command is unchanged (idempotent)", () => {
  const once = upsertCheckpointHook({}, CMD).settings;
  const { status } = upsertCheckpointHook(once, CMD);
  assert.equal(status, "unchanged");
});

test("a changed command path is updated in place, not duplicated", () => {
  const once = upsertCheckpointHook({}, CMD).settings;
  const { settings, status } = upsertCheckpointHook(once, '"/new/node" "/abs/baton/cli" checkpoint');
  assert.equal(status, "updated");
  const stop = (settings.hooks as { Stop: { hooks: { command: string }[] }[] }).Stop;
  assert.equal(stop.length, 1);
  assert.match(stop[0]!.hooks[0]!.command, /\/new\/node/);
});

test("preserves unrelated settings and other Stop hooks", () => {
  const existing = {
    model: "claude-opus-4-8",
    hooks: {
      PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo edited" }] }],
      Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }],
    },
  };
  const { settings } = upsertCheckpointHook(existing, CMD);
  const hooks = settings.hooks as { PostToolUse: unknown[]; Stop: unknown[] };
  assert.equal((settings as { model: string }).model, "claude-opus-4-8");
  assert.equal(hooks.PostToolUse.length, 1);
  assert.equal(hooks.Stop.length, 2); // existing "echo bye" + ours
});

test("removeCheckpointHook strips only our hook and reports removal", () => {
  const installed = upsertCheckpointHook(
    { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }] } },
    CMD,
  ).settings;
  const { settings, removed } = removeCheckpointHook(installed);
  assert.equal(removed, true);
  const stop = (settings.hooks as { Stop: { hooks: { command: string }[] }[] }).Stop;
  assert.equal(stop.length, 1);
  assert.equal(stop[0]!.hooks[0]!.command, "echo bye"); // unrelated hook preserved
});

test("removeCheckpointHook drops empty Stop and hooks keys", () => {
  const installed = upsertCheckpointHook({}, CMD).settings;
  const { settings, removed } = removeCheckpointHook(installed);
  assert.equal(removed, true);
  assert.deepEqual(settings, {}); // Stop emptied → removed; hooks emptied → removed
});

test("removeCheckpointHook on settings without our hook is a no-op", () => {
  const { removed } = removeCheckpointHook({ hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } });
  assert.equal(removed, false);
});
