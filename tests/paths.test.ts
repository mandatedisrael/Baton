import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { findProjectRoot } from "../src/store/paths.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "baton-paths-test-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("global identity directory is not mistaken for a project", () => {
  const child = join(root, "project", "src");
  mkdirSync(join(root, ".baton"), { recursive: true });
  mkdirSync(child, { recursive: true });
  writeFileSync(join(root, ".baton", "identity.json"), "{}\n");
  assert.equal(findProjectRoot(child), null);
});

test("project config remains the upward-search marker", () => {
  const child = join(root, "project", "src");
  mkdirSync(join(root, "project", ".baton"), { recursive: true });
  mkdirSync(child, { recursive: true });
  writeFileSync(join(root, "project", ".baton", "config.json"), "{}\n");
  assert.equal(findProjectRoot(child), join(root, "project"));
});
