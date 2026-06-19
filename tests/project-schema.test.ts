import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProjectConfig } from "../src/schema/project.ts";

function config() {
  return {
    schemaVersion: 1,
    projectId: "project-1",
    createdAt: "2026-06-19T12:00:00.000Z",
    head: null,
    remote: {
      network: "testnet",
      rpcUrl: "https://fullnode.testnet.sui.io:443",
      packageId: "0x1234",
      projectObjectId: "0x5678",
      ownerCapId: "0x9abc",
      registrationTx: "transaction-digest",
      registeredAt: "2026-06-19T12:05:00.000Z",
      seal: {
        threshold: 1,
        serverConfigs: [
          {
            objectId: "0xb012",
            weight: 1,
            aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com",
          },
        ],
      },
    },
  };
}

test("parseProjectConfig accepts strict public registration metadata", () => {
  const parsed = parseProjectConfig(config());
  assert.equal(parsed.remote?.network, "testnet");
  assert.equal(parsed.remote?.seal.threshold, 1);
});

test("parseProjectConfig migrates pre-network config to local-only", () => {
  const { remote: _, ...legacy } = config();
  assert.equal(parseProjectConfig(legacy).remote, null);
});

test("parseProjectConfig rejects unsafe URLs and invalid object ids", () => {
  assert.throws(
    () => parseProjectConfig({ ...config(), remote: { ...config().remote, rpcUrl: "file:///tmp/node" } }),
    /http or https/,
  );
  assert.throws(
    () => parseProjectConfig({ ...config(), remote: { ...config().remote, packageId: "not-an-id" } }),
    /Sui object id/,
  );
});

test("parseProjectConfig requires an attainable Seal threshold", () => {
  const value = config();
  value.remote.seal.threshold = 2;
  assert.throws(() => parseProjectConfig(value), /cannot exceed total server weight/);
});

test("parseProjectConfig rejects private or unknown config fields", () => {
  const value = config();
  (value.remote.seal.serverConfigs[0] as Record<string, unknown>).apiKey = "must-not-be-stored";
  assert.throws(() => parseProjectConfig(value), /unknown key/);
});
