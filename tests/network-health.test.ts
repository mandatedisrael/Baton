import { test } from "node:test";
import assert from "node:assert/strict";
import { probeHttpsEndpoint } from "../src/chain/network-health.ts";

test("probeHttpsEndpoint reports DNS and HTTP reachability without requiring a 2xx response", async () => {
  const seen: string[] = [];
  const result = await probeHttpsEndpoint("https://service.example/path", {
    lookup: async (hostname) => {
      seen.push(hostname);
      return { address: "203.0.113.7", family: 4 };
    },
    fetch: async (input, init) => {
      seen.push(String(input));
      assert.equal(init?.method, "HEAD");
      return new Response(null, { status: 404 });
    },
  });

  assert.deepEqual(seen, ["service.example", "https://service.example/path"]);
  assert.deepEqual(result, { url: "https://service.example", address: "203.0.113.7", status: 404 });
});

test("probeHttpsEndpoint rejects insecure endpoints before resolving them", async () => {
  await assert.rejects(() => probeHttpsEndpoint("http://service.example"), /must use https/);
});
