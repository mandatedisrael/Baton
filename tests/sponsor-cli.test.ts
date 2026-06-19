import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let root: string;
let statePath: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-sponsor-cli-"));
  statePath = join(root, "sponsor.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function sponsor(...args: string[]) {
  return spawnSync(process.execPath, [join(process.cwd(), "src/sponsor/index.ts"), ...args, "--state", statePath], {
    encoding: "utf8",
  });
}

test("operator CLI issues, lists, revokes, and prunes bound invitations", () => {
  const issued = sponsor("invite", "--ttl-hours", "1", "--recipient", "0x2", "--project", "project-1");
  assert.equal(issued.status, 0, issued.stderr);
  assert.match(issued.stdout.trim(), /^[A-Za-z0-9_-]{43}$/);
  const id = issued.stderr.match(/Sponsor invitation ([0-9a-f-]{36}) created/)?.[1];
  assert.ok(id);

  const listed = sponsor("list", "--json");
  assert.equal(listed.status, 0, listed.stderr);
  const invites = JSON.parse(listed.stdout);
  assert.equal(invites.length, 1);
  assert.equal(invites[0].id, id);
  assert.equal(invites[0].status, "available");
  assert.equal(invites[0].recipient, "0x0000000000000000000000000000000000000000000000000000000000000002");
  assert.equal(invites[0].projectId, "project-1");

  const revoked = sponsor("revoke", "--id", id);
  assert.equal(revoked.status, 0, revoked.stderr);
  assert.match(revoked.stderr, /revoked/);
  const pruned = sponsor("prune");
  assert.equal(pruned.status, 0, pruned.stderr);
  assert.match(pruned.stderr, /Pruned 1/);
  const empty = sponsor("list", "--json");
  assert.deepEqual(JSON.parse(empty.stdout), []);
});
