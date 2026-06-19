import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUploadJob } from "../src/chain/queue.ts";
import { BatonError } from "../src/core/errors.ts";
import { finalize } from "../src/core/finalize.ts";
import type { RemoteSidecar } from "../src/schema/remote.ts";
import { ProjectStore } from "../src/store/project.ts";
import { uploadJobPath } from "../src/store/paths.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-remote-store-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function sealed(store: ProjectStore) {
  return finalize(store.loadWorkingState(), {
    projectId: store.config().projectId,
    author: "test",
    tool: "other",
    captureMode: "fallback",
    parents: [],
    timestamp: "2026-06-19T12:00:00.000Z",
  });
}

test("upload jobs round-trip and list in creation order", () => {
  const store = ProjectStore.init(root);
  const first = sealed(store);
  const firstJob = createUploadJob(first.id, first.handoff, new Date("2026-06-19T12:00:00Z"));
  store.saveUploadJob(firstJob);

  const second = finalize(store.loadWorkingState(), {
    projectId: store.config().projectId,
    author: "test",
    tool: "other",
    captureMode: "fallback",
    parents: [first.id],
    timestamp: "2026-06-19T12:01:00.000Z",
  });
  store.saveUploadJob(createUploadJob(second.id, second.handoff, new Date("2026-06-19T12:01:00Z")));

  assert.deepEqual(store.loadUploadJob(first.id), firstJob);
  assert.deepEqual(store.listUploadJobs().map((job) => job.handoffId), [first.id, second.id]);
});

test("enqueueUploadJob preserves progress from an existing job", () => {
  const store = ProjectStore.init(root);
  const { handoff, id } = sealed(store);
  const original = createUploadJob(id, handoff, new Date("2026-06-19T12:00:00Z"));
  store.enqueueUploadJob(original);
  store.saveUploadJob({
    ...original,
    status: "failed",
    attempts: 1,
    updatedAt: "2026-06-19T12:01:00.000Z",
    lastError: "offline",
  });

  const result = store.enqueueUploadJob(createUploadJob(id, handoff, new Date("2026-06-19T12:02:00Z")));
  assert.equal(result.status, "failed");
  assert.equal(result.attempts, 1);
  assert.equal(store.loadUploadJob(id).lastError, "offline");
});

test("loadUploadJob rejects a corrupt queue document", () => {
  const store = ProjectStore.init(root);
  const { handoff, id } = sealed(store);
  store.saveUploadJob(createUploadJob(id, handoff));
  writeFileSync(uploadJobPath(root, id), JSON.stringify({ nope: true }));
  assert.throws(
    () => store.loadUploadJob(id),
    (err: unknown) => err instanceof BatonError && err.code === "INVALID_STATE",
  );
});

test("remote sidecars round-trip after completed publication", () => {
  const store = ProjectStore.init(root);
  const { id } = sealed(store);
  const sidecar: RemoteSidecar = {
    schemaVersion: 1,
    handoffId: id,
    handoffBlobId: "walrus-handoff",
    attachments: [],
    anchor: {
      network: "testnet",
      projectObjectId: "0x123",
      txDigest: "tx-digest",
      anchoredAt: "2026-06-19T12:05:00.000Z",
    },
  };
  store.saveRemoteSidecar(sidecar);
  assert.deepEqual(store.loadRemoteSidecar(id), sidecar);
});

test("missing queue and remote records report NOT_FOUND", () => {
  const store = ProjectStore.init(root);
  const id = "a".repeat(64);
  assert.throws(
    () => store.loadUploadJob(id),
    (err: unknown) => err instanceof BatonError && err.code === "NOT_FOUND",
  );
  assert.throws(
    () => store.loadRemoteSidecar(id),
    (err: unknown) => err instanceof BatonError && err.code === "NOT_FOUND",
  );
});
