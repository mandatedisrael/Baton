import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, CanonicalizeError } from "../src/core/canonical.ts";

describe("canonicalize", () => {
  it("sorts object keys", () => {
    assert.equal(canonicalize({ b: 1, a: 2, c: 3 }), '{"a":2,"b":1,"c":3}');
  });

  it("sorts nested object keys", () => {
    assert.equal(
      canonicalize({ z: { y: 1, x: 2 }, a: [{ b: 1, a: 0 }] }),
      '{"a":[{"a":0,"b":1}],"z":{"x":2,"y":1}}',
    );
  });

  it("preserves array order", () => {
    assert.equal(canonicalize([3, 1, 2]), "[3,1,2]");
  });

  it("emits no whitespace", () => {
    assert.doesNotMatch(canonicalize({ a: [1, 2], b: "x y" }), /[\n\t]| (?!y)/);
  });

  it("is insensitive to key insertion order", () => {
    const a = { mission: "m", status: "done", decisions: [] };
    const b = { decisions: [], status: "done", mission: "m" };
    assert.equal(canonicalize(a), canonicalize(b));
  });

  it("drops undefined object properties", () => {
    assert.equal(canonicalize({ a: 1, b: undefined }), '{"a":1}');
  });

  it("handles unicode strings via JSON escaping", () => {
    assert.equal(canonicalize({ s: "héllo  " }), JSON.stringify({ s: "héllo  " }));
  });

  it("serializes primitives", () => {
    assert.equal(canonicalize(null), "null");
    assert.equal(canonicalize(true), "true");
    assert.equal(canonicalize(1.5), "1.5");
    assert.equal(canonicalize("x"), '"x"');
  });

  it("rejects NaN and Infinity", () => {
    assert.throws(() => canonicalize({ n: NaN }), CanonicalizeError);
    assert.throws(() => canonicalize({ n: Infinity }), CanonicalizeError);
  });

  it("rejects undefined array elements", () => {
    assert.throws(() => canonicalize([1, undefined, 3]), CanonicalizeError);
  });

  it("rejects functions and bigints", () => {
    assert.throws(() => canonicalize({ f: () => 1 }), CanonicalizeError);
    assert.throws(() => canonicalize({ b: 1n }), CanonicalizeError);
  });
});
