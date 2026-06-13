import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BatonError } from "../src/core/errors.ts";
import { finalize } from "../src/core/finalize.ts";
import { applyPatch, emptyWorkingState } from "../src/core/working-state.ts";
import { handoffPath } from "../src/store/paths.ts";
import { ProjectStore } from "../src/store/project.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function passOne(store: ProjectStore): string {
  const config = store.config();
  const state = applyPatch(store.loadWorkingState(), {
    kind: "set_mission",
    mission: "test mission",
  });
  store.saveWorkingState(state);
  const { handoff, id } = finalize(state, {
    projectId: config.projectId,
    author: "test",
    tool: "other",
    captureMode: "fallback",
    parents: config.head ? [config.head] : [],
  });
  store.saveHandoff(handoff, id);
  store.setHead(id);
  return id;
}

describe("ProjectStore", () => {
  it("init creates a valid project; double-init refuses", () => {
    const store = ProjectStore.init(root);
    assert.ok(store.config().projectId);
    assert.equal(store.config().head, null);
    assert.throws(() => ProjectStore.init(root), BatonError);
  });

  it("open walks up from a subdirectory (like git)", () => {
    ProjectStore.init(root);
    const sub = join(root, "deeply", "nested");
    mkdirSync(sub, { recursive: true });
    assert.equal(ProjectStore.open(sub).root, root);
  });

  it("open outside any project throws NOT_INITIALIZED", () => {
    assert.throws(() => ProjectStore.open(root), BatonError);
  });

  it("working state round-trips", () => {
    const store = ProjectStore.init(root);
    const s = applyPatch(store.loadWorkingState(), { kind: "set_mission", mission: "m" });
    store.saveWorkingState(s);
    assert.equal(store.loadWorkingState().mission, "m");
  });

  it("pass flow: save, head advances, lineage threads", () => {
    const store = ProjectStore.init(root);
    const id1 = passOne(store);
    assert.equal(store.config().head, id1);
    const id2 = passOne(store);
    assert.deepEqual(store.loadHandoff(id2).meta.parents, [id1]);
  });

  it("saveHandoff refuses a wrong id", () => {
    const store = ProjectStore.init(root);
    const state = store.loadWorkingState();
    const { handoff } = finalize(state, {
      projectId: "p",
      author: "t",
      tool: "other",
      captureMode: "fallback",
      parents: [],
    });
    assert.throws(() => store.saveHandoff(handoff, "0".repeat(64)), BatonError);
  });

  it("verify-on-read: a tampered handoff refuses to load", () => {
    const store = ProjectStore.init(root);
    const id = passOne(store);
    const path = handoffPath(root, id);
    const doc = JSON.parse(readFileSync(path, "utf8"));
    doc.mission = "tampered mission";
    writeFileSync(path, JSON.stringify(doc));
    assert.throws(() => store.loadHandoff(id), /failed verification/);
  });

  it("loadHandoff on unknown id throws NOT_FOUND", () => {
    const store = ProjectStore.init(root);
    assert.throws(
      () => store.loadHandoff("0".repeat(64)),
      (err: unknown) => err instanceof BatonError && err.code === "NOT_FOUND",
    );
  });

  it("listHandoffIds reflects what was saved", () => {
    const store = ProjectStore.init(root);
    assert.deepEqual(store.listHandoffIds(), []);
    const id = passOne(store);
    assert.deepEqual(store.listHandoffIds(), [id]);
  });
});
