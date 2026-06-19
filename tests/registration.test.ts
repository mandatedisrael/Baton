import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegistrationTransaction, extractRegistrationObjects } from "../src/chain/registration.ts";

const PACKAGE = `0x${"1".repeat(64)}`;

test("buildRegistrationTransaction creates the real Move call with UTF-8 project bytes", () => {
  const tx = buildRegistrationTransaction(PACKAGE, "project-1");
  const data = tx.getData();
  assert.equal(data.commands.length, 1);
  const command = data.commands[0]!;
  assert.equal(command.$kind, "MoveCall");
  if (command.$kind !== "MoveCall") assert.fail("expected MoveCall");
  assert.equal(command.MoveCall.package, PACKAGE);
  assert.equal(command.MoveCall.module, "memory");
  assert.equal(command.MoveCall.function, "create_project");
});

test("buildRegistrationTransaction enforces the onchain project id bound", () => {
  assert.throws(() => buildRegistrationTransaction(PACKAGE, "x".repeat(129)), /1–128 UTF-8 bytes/);
});

test("extractRegistrationObjects requires both concrete contract objects", () => {
  const changes = [
    {
      type: "created" as const,
      sender: "0xsender",
      owner: { Shared: { initial_shared_version: "1" } },
      objectType: `${PACKAGE}::memory::ProjectMemory`,
      objectId: "0xproject",
      version: "1",
      digest: "project-digest",
    },
    {
      type: "created" as const,
      sender: "0xsender",
      owner: { AddressOwner: "0xsender" },
      objectType: `${PACKAGE}::memory::OwnerCap`,
      objectId: "0xcap",
      version: "1",
      digest: "cap-digest",
    },
  ];
  assert.deepEqual(extractRegistrationObjects(PACKAGE, changes), {
    projectObjectId: "0xproject",
    ownerCapId: "0xcap",
  });
  assert.throws(() => extractRegistrationObjects(PACKAGE, changes.slice(0, 1)), /did not create/);
});
