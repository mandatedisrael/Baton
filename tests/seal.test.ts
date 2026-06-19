import { test } from "node:test";
import assert from "node:assert/strict";
import { SealPayloadEncryptor, validateSealNetworkOptions } from "../src/chain/seal.ts";

test("SealPayloadEncryptor forwards the verified encryption request", async () => {
  let received: Record<string, unknown> | undefined;
  const client = {
    async encrypt(input: Record<string, unknown>) {
      received = input;
      return { encryptedObject: new Uint8Array([7, 8, 9]), key: new Uint8Array([1, 2, 3]) };
    },
  };
  const encryptor = new SealPayloadEncryptor(client as never);
  const encrypted = await encryptor.encrypt({
    threshold: 2,
    packageId: "0x1234",
    identity: "0xabcd",
    data: new Uint8Array([1]),
    aad: new Uint8Array([2]),
  });

  assert.deepEqual(encrypted, new Uint8Array([7, 8, 9]));
  assert.deepEqual(received, {
    threshold: 2,
    packageId: "0x1234",
    id: "0xabcd",
    data: new Uint8Array([1]),
    aad: new Uint8Array([2]),
  });
});

test("Seal network configuration fails early on unsafe input", () => {
  assert.throws(
    () => validateSealNetworkOptions({ network: "testnet", rpcUrl: "file:///tmp/rpc", serverConfigs: [] }),
    /http or https/,
  );
  assert.throws(
    () => validateSealNetworkOptions({ network: "testnet", rpcUrl: "https://rpc.example", serverConfigs: [] }),
    /at least one/,
  );
  assert.throws(
    () =>
      validateSealNetworkOptions({
        network: "testnet",
        rpcUrl: "https://rpc.example",
        serverConfigs: [{ objectId: "not-hex", weight: 1 }],
      }),
    /hex object id/,
  );
});
