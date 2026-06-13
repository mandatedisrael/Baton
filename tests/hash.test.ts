import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HASH_ALGORITHM, hashBytes, hashCanonical, shortId } from "../src/core/hash.ts";

describe("hash", () => {
  it("is deterministic", () => {
    assert.equal(hashCanonical({ a: 1, b: [2, 3] }), hashCanonical({ b: [2, 3], a: 1 }));
  });

  it("changes when content changes", () => {
    assert.notEqual(hashCanonical({ a: 1 }), hashCanonical({ a: 2 }));
  });

  it("produces 64-char hex (SHA-256)", () => {
    assert.equal(HASH_ALGORITHM, "sha256");
    assert.match(hashCanonical({}), /^[0-9a-f]{64}$/);
  });

  it("matches the SHA-256 test vector for empty input", () => {
    assert.equal(
      hashBytes(new Uint8Array(0)),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("shortId is a 12-char prefix", () => {
    const h = hashCanonical({ x: 1 });
    assert.equal(shortId(h), h.slice(0, 12));
    assert.equal(shortId(h).length, 12);
  });
});
