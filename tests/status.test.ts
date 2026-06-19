import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectStatus } from "../src/core/status.ts";
import { ProjectStore } from "../src/store/project.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "baton-status-test-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("projectStatus returns a stable structured MCP/CLI view", () => {
  const store = ProjectStore.init(root);
  const status = projectStatus(store);
  assert.equal(status.projectId, store.config().projectId);
  assert.equal(status.head, null);
  assert.equal(status.status, "in-progress");
  assert.deepEqual(status.nextActions, []);
  assert.equal(status.remoteRegistered, false);
});
