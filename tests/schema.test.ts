import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseHandoff, type Handoff } from "../src/schema/handoff.ts";

export function validHandoff(): Handoff {
  return {
    schemaVersion: 1,
    meta: {
      projectId: "p-1",
      tool: "claude-code",
      captureMode: "transcript",
      author: "dare",
      timestamp: "2026-06-13T12:00:00.000Z",
      parents: [],
    },
    mission: "refactor auth middleware",
    status: "in-progress",
    decisions: [
      {
        id: "d1",
        choice: "use queue-based session handling",
        rationale: "middleware wrapping raced on session tokens",
        citation: { attachmentId: "t1", fromLine: 120, toLine: 141 },
      },
    ],
    graveyard: [
      {
        id: "g1",
        approach: "wrap middleware twice",
        reason: "session-token race",
        citation: { attachmentId: "t1", fromLine: 80, toLine: 102 },
      },
    ],
    repoMap: {
      touched: [{ path: "src/auth.ts", contentHash: "abc" }],
      important: [{ path: "src/auth.ts" }],
      entryPoints: ["src/index.ts"],
    },
    nextActions: ["implement queue approach"],
    envNotes: ["node 22, redis 7 local"],
    attachments: [
      { id: "t1", kind: "transcript", contentHash: "deadbeef", bytes: 1024, blobRef: null },
    ],
    verbatimRules: ["never commit .env"],
    fidelity: { score: 0.93, graderModel: "haiku", rubricVersion: "1", sections: { graveyard: 0.97 } },
  };
}

describe("handoff schema v1", () => {
  it("accepts a fully-populated handoff", () => {
    assert.deepEqual(parseHandoff(validHandoff()), validHandoff());
  });

  it("accepts null fidelity score (ungraded)", () => {
    const h = { ...validHandoff(), fidelity: { score: null } };
    assert.equal(parseHandoff(h).fidelity.score, null);
  });

  it("rejects unknown schema version", () => {
    assert.throws(() => parseHandoff({ ...validHandoff(), schemaVersion: 2 }));
  });

  it("rejects unknown keys (content-addressed docs must be exact)", () => {
    assert.throws(() => parseHandoff({ ...validHandoff(), extra: "smuggled" }), /unknown key/);
    const h = validHandoff();
    assert.throws(
      () => parseHandoff({ ...h, meta: { ...h.meta, injected: true } }),
      /unknown key/,
    );
  });

  it("rejects fidelity score out of range", () => {
    assert.throws(() => parseHandoff({ ...validHandoff(), fidelity: { score: 1.2 } }));
  });

  it("rejects inverted citation spans", () => {
    const h = validHandoff();
    h.decisions[0]!.citation = { attachmentId: "t1", fromLine: 10, toLine: 5 };
    assert.throws(() => parseHandoff(h));
  });

  it("rejects bad tool / capture mode / status", () => {
    const h = validHandoff();
    assert.throws(() => parseHandoff({ ...h, status: "paused" }));
    assert.throws(() => parseHandoff({ ...h, meta: { ...h.meta, tool: "vim" } }));
    assert.throws(() => parseHandoff({ ...h, meta: { ...h.meta, captureMode: "psychic" } }));
  });

  it("rejects non-ISO timestamps", () => {
    const h = validHandoff();
    assert.throws(() => parseHandoff({ ...h, meta: { ...h.meta, timestamp: "yesterday" } }));
  });
});
