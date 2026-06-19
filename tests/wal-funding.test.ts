import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWalExchangeTransaction } from "../src/chain/wal-funding.ts";

test("buildWalExchangeTransaction swaps gas SUI through the official exchange contract", () => {
  const tx = buildWalExchangeTransaction({
    exchangePackageId: "0x1234",
    exchangeObjectId: "0x5678",
    recipient: "0x9abc",
    amountMist: 100_000_000n,
  });
  const commands = tx.getData().commands;
  assert.deepEqual(commands.map((command) => command.$kind), ["SplitCoins", "MoveCall", "TransferObjects"]);
  const call = commands[1];
  assert.equal(call?.$kind, "MoveCall");
  if (call?.$kind === "MoveCall") assert.equal(call.MoveCall.function, "exchange_all_for_wal");
});

test("buildWalExchangeTransaction bounds user-controlled spending", () => {
  const base = { exchangePackageId: "0x1234", exchangeObjectId: "0x5678", recipient: "0x9abc" };
  assert.throws(() => buildWalExchangeTransaction({ ...base, amountMist: 0n }), /between 1 MIST/);
  assert.throws(() => buildWalExchangeTransaction({ ...base, amountMist: 1_000_000_000_001n }), /1,000 SUI/);
});
