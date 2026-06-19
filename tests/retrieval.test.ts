import { test } from "node:test";
import assert from "node:assert/strict";
import { createWalrusRetriever, fetchVerifiedCiphertext } from "../src/chain/retrieval.ts";
import { hashBytes } from "../src/core/hash.ts";

const BLOB_ID = "IxAzdh40gIAqQB8g9_DG7eT6dQcLjHIUXykzIvUoYFM";

test("Walrus retriever uses the configured HTTPS aggregator", async () => {
  let requested = "";
  const retriever = createWalrusRetriever({
    aggregatorUrl: "https://aggregator.example/base",
    fetch: async (input) => {
      requested = String(input);
      return new Response(Uint8Array.from([1, 2, 3]));
    },
  });
  assert.deepEqual(await retriever.fetch(BLOB_ID), Uint8Array.from([1, 2, 3]));
  assert.equal(requested, `https://aggregator.example/v1/blobs/${BLOB_ID}`);
});

test("Walrus retriever rejects unsafe ids, endpoints, HTTP failures, and oversized payloads", async () => {
  assert.throws(() => createWalrusRetriever({ aggregatorUrl: "http://aggregator.example" }), /HTTPS/);
  const missing = createWalrusRetriever({
    aggregatorUrl: "https://aggregator.example",
    fetch: async () => new Response("missing", { status: 404 }),
  });
  await assert.rejects(missing.fetch(BLOB_ID), /HTTP 404/);
  await assert.rejects(missing.fetch("../escape"), /canonical base64url/);

  const oversized = createWalrusRetriever({
    aggregatorUrl: "https://aggregator.example",
    maxBytes: 2,
    fetch: async () => new Response(Uint8Array.from([1, 2, 3])),
  });
  await assert.rejects(oversized.fetch(BLOB_ID), /retrieval limit/);
});

test("fetchVerifiedCiphertext refuses bytes that differ from the local publication receipt", async () => {
  const expected = Uint8Array.from([1, 2, 3]);
  const retriever = { fetch: async () => expected };
  assert.deepEqual(
    await fetchVerifiedCiphertext({ retriever, blobId: BLOB_ID, encryptedHash: hashBytes(expected) }),
    expected,
  );
  await assert.rejects(
    fetchVerifiedCiphertext({ retriever, blobId: BLOB_ID, encryptedHash: "a".repeat(64) }),
    /hashes to/,
  );
});
