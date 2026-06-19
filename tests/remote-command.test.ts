import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHandoffAvailable } from "../src/cli/remote.ts";
import { finalize } from "../src/core/finalize.ts";
import { ProjectStore } from "../src/store/project.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "baton-remote-command-test-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("ensureHandoffAvailable prefers the verified local baton", async () => {
  const store = ProjectStore.init(root);
  const result = finalize(store.loadWorkingState(), {
    projectId: store.config().projectId,
    author: "test",
    tool: "other",
    captureMode: "fallback",
    parents: [],
  });
  store.saveHandoff(result.handoff, result.id);
  let recovered = false;
  const handoff = await ensureHandoffAvailable(store, result.id, async () => {
    recovered = true;
    return result.handoff;
  });
  assert.deepEqual(handoff, result.handoff);
  assert.equal(recovered, false);
});

test("ensureHandoffAvailable recovers only a genuinely missing baton", async () => {
  const store = ProjectStore.init(root);
  const id = "a".repeat(64);
  let requested = "";
  const result = finalize(store.loadWorkingState(), {
    projectId: store.config().projectId,
    author: "test",
    tool: "other",
    captureMode: "fallback",
    parents: [],
  });
  const handoff = await ensureHandoffAvailable(store, id, async (value) => {
    requested = value;
    return result.handoff;
  });
  assert.equal(requested, id);
  assert.deepEqual(handoff, result.handoff);
});
