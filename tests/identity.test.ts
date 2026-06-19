import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIdentity, loadOrCreateIdentity } from "../src/chain/identity.ts";

let root: string;
let path: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-identity-test-"));
  path = join(root, ".baton", "identity.json");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("creates and reloads a real Ed25519 Sui identity with restrictive permissions", async () => {
  const created = loadOrCreateIdentity(path, new Date("2026-06-19T12:00:00Z"));
  const loaded = loadIdentity(path);
  assert.equal(loaded.record.address, created.record.address);
  assert.match(loaded.record.secretKey, /^suiprivkey1/);
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.equal(lstatSync(join(root, ".baton")).mode & 0o777, 0o700);

  const message = new TextEncoder().encode("baton identity proof");
  const { signature } = await loaded.keypair.signPersonalMessage(message);
  assert.equal(await loaded.keypair.getPublicKey().verifyPersonalMessage(message, signature), true);
});

test("loadOrCreateIdentity is stable and never rotates an existing key", () => {
  const first = loadOrCreateIdentity(path);
  const second = loadOrCreateIdentity(path);
  assert.equal(second.record.secretKey, first.record.secretKey);
  assert.equal(second.record.address, first.record.address);
});

test("loadIdentity detects address tampering", () => {
  loadOrCreateIdentity(path);
  const record = JSON.parse(readFileSync(path, "utf8"));
  record.address = `0x${"0".repeat(64)}`;
  writeFileSync(path, JSON.stringify(record));
  assert.throws(() => loadIdentity(path), /does not match/);
});

test("loadIdentity rejects symlinked key material", () => {
  const real = join(root, "real.json");
  writeFileSync(real, "{}", { mode: 0o600 });
  mkdirSync(join(root, ".baton"));
  symlinkSync(real, path);
  assert.throws(() => loadIdentity(path), /refusing symlinked/);
});

test("loadIdentity repairs overly broad file permissions", () => {
  loadOrCreateIdentity(path);
  chmodSync(path, 0o644);
  loadIdentity(path);
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
});
