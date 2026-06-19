import { test } from "node:test";
import assert from "node:assert/strict";
import { runPublish } from "../src/cli/commands/publish.ts";

test("publish runs encryption, upload, and anchoring in strict order", async () => {
  const calls: string[] = [];
  await runPublish("/project", {
    encrypt: async (cwd) => { calls.push(`encrypt:${cwd}`); },
    upload: async (cwd) => { calls.push(`upload:${cwd}`); },
    anchor: async (cwd) => { calls.push(`anchor:${cwd}`); },
  });
  assert.deepEqual(calls, ["encrypt:/project", "upload:/project", "anchor:/project"]);
});

test("publish stops before dependent stages after a failure", async () => {
  const calls: string[] = [];
  await assert.rejects(
    runPublish("/project", {
      encrypt: async () => { calls.push("encrypt"); },
      upload: async () => { calls.push("upload"); throw new Error("offline"); },
      anchor: async () => { calls.push("anchor"); },
    }),
    /offline/,
  );
  assert.deepEqual(calls, ["encrypt", "upload"]);
});
