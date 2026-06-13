import { test } from "node:test";
import assert from "node:assert/strict";
import { sliceDelta, transcriptAttachmentId } from "../src/distiller/checkpoint.ts";
import type { CapturedSession } from "../src/distiller/capture/transcript.ts";

function session(sessionId: string | null, lines: number[]): CapturedSession {
  return {
    tool: "claude-code",
    sessionId,
    model: null,
    cwd: null,
    gitBranch: null,
    messages: lines.map((line) => ({
      line,
      role: "user",
      uuid: null,
      parentUuid: null,
      isSidechain: false,
      isMeta: false,
      timestamp: null,
      text: `turn ${line}`,
      thinking: "",
      toolUses: [],
      toolResults: [],
    })),
    raw: { bytes: 0, hash: "h", lineCount: lines.length ? Math.max(...lines) : 0 },
  };
}

test("first checkpoint of a session yields all turns and advances the cursor", () => {
  const { delta, cursor } = sliceDelta(session("S", [1, 2, 3, 5]), { sessionId: null, line: 0 });
  assert.deepEqual(delta.map((m) => m.line), [1, 2, 3, 5]);
  assert.deepEqual(cursor, { sessionId: "S", line: 5 });
});

test("same session yields only turns past the cursor", () => {
  const { delta, cursor } = sliceDelta(session("S", [1, 2, 3, 5]), { sessionId: "S", line: 3 });
  assert.deepEqual(delta.map((m) => m.line), [5]);
  assert.deepEqual(cursor, { sessionId: "S", line: 5 });
});

test("a new session id re-reads from the top", () => {
  const { delta, cursor } = sliceDelta(session("NEW", [1, 2]), { sessionId: "OLD", line: 99 });
  assert.deepEqual(delta.map((m) => m.line), [1, 2]);
  assert.deepEqual(cursor, { sessionId: "NEW", line: 2 });
});

test("no new turns yields an empty delta and a stable cursor", () => {
  const { delta, cursor } = sliceDelta(session("S", [1, 2, 3]), { sessionId: "S", line: 3 });
  assert.equal(delta.length, 0);
  assert.deepEqual(cursor, { sessionId: "S", line: 3 });
});

test("a null session id is never treated as the same session", () => {
  const { delta } = sliceDelta(session(null, [1, 2]), { sessionId: null, line: 1 });
  assert.deepEqual(delta.map((m) => m.line), [1, 2]); // re-read, since null != null here
});

test("transcriptAttachmentId is stable per session, undefined without one", () => {
  assert.equal(transcriptAttachmentId(session("S", [1])), "transcript-S");
  assert.equal(transcriptAttachmentId(session(null, [1])), undefined);
});
