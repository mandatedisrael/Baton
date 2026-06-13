import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExtractionPrompt,
  extractCheckpoint,
  parseExtractionResponse,
} from "../src/distiller/extract.ts";
import { emptyWorkingState, applyPatches, type WorkingState } from "../src/core/working-state.ts";
import type { CaptureMessage } from "../src/distiller/capture/transcript.ts";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/llm/client.ts";

function msg(partial: Partial<CaptureMessage> & { line: number; role: CaptureMessage["role"] }): CaptureMessage {
  return {
    uuid: null,
    parentUuid: null,
    isSidechain: false,
    isMeta: false,
    timestamp: null,
    text: "",
    thinking: "",
    toolUses: [],
    toolResults: [],
    ...partial,
  };
}

function stateWithDecision(): WorkingState {
  return applyPatches(emptyWorkingState(new Date("2026-06-13T00:00:00Z")), [
    { kind: "set_mission", mission: "fix auth" },
    { kind: "add_decision", decision: { id: "d-existing", choice: "use a queue", rationale: "" } },
  ]);
}

const CTX = { transcriptLineCount: 100, attachmentId: "att-1" };

test("buildExtractionPrompt includes the delta, state, decision ids, and op vocabulary", () => {
  const { system, user } = buildExtractionPrompt({
    delta: [
      msg({ line: 12, role: "assistant", text: "Trying Redis pub/sub", toolUses: [{ id: "t", name: "Edit", input: { path: "a.ts" } }] }),
      msg({ line: 14, role: "user", toolResults: [{ toolUseId: "t", text: "connection pool exhausted", isError: true }] }),
    ],
    state: stateWithDecision(),
    transcriptLineCount: 100,
    attachmentId: "att-1",
  });
  assert.match(system, /move_to_graveyard/);
  assert.match(system, /GRAVEYARD/);
  assert.match(user, /Trying Redis pub\/sub/);
  assert.match(user, /\[line 12\]/);
  assert.match(user, /d-existing/); // existing decision id surfaced for update
  assert.match(user, /connection pool exhausted/);
});

test("meta messages are excluded from the rendered delta", () => {
  const { user } = buildExtractionPrompt({
    delta: [msg({ line: 1, role: "user", text: "INJECTED REMINDER", isMeta: true })],
    state: emptyWorkingState(),
    transcriptLineCount: 10,
  });
  assert.doesNotMatch(user, /INJECTED REMINDER/);
});

test("parses well-formed ops, generates ids, keeps in-range citations", () => {
  const response = "```json\n" + JSON.stringify({
    ops: [
      { kind: "set_status", status: "blocked" },
      { kind: "add_decision", choice: "use SSE", rationale: "avoids the pool", citation: { fromLine: 5, toLine: 7 } },
      { kind: "move_to_graveyard", approach: "Redis pub/sub", reason: "pool exhausted", citation: { fromLine: 12, toLine: 14 } },
      { kind: "set_next_actions", actions: ["wire SSE", ""] },
    ],
  }) + "\n```";

  const ops = parseExtractionResponse(response, CTX);
  assert.equal(ops.length, 4);

  assert.deepEqual(ops[0], { kind: "set_status", status: "blocked" });

  const add = ops[1]!;
  assert.equal(add.kind, "add_decision");
  if (add.kind === "add_decision") {
    assert.ok(add.decision.id.startsWith("d-"));
    assert.equal(add.decision.choice, "use SSE");
    assert.deepEqual(add.decision.citation, { attachmentId: "att-1", fromLine: 5, toLine: 7 });
  }

  const grave = ops[2]!;
  assert.equal(grave.kind, "move_to_graveyard");
  if (grave.kind === "move_to_graveyard") {
    assert.ok(grave.entry.id.startsWith("g-"));
    assert.equal(grave.entry.approach, "Redis pub/sub");
    assert.deepEqual(grave.entry.citation, { attachmentId: "att-1", fromLine: 12, toLine: 14 });
  }

  const next = ops[3]!;
  assert.equal(next.kind, "set_next_actions");
  if (next.kind === "set_next_actions") assert.deepEqual(next.actions, ["wire SSE"]); // empty filtered
});

test("drops out-of-range citations but keeps the op", () => {
  const ops = parseExtractionResponse(
    JSON.stringify({ ops: [{ kind: "add_decision", choice: "x", citation: { fromLine: 5, toLine: 9999 } }] }),
    CTX,
  );
  assert.equal(ops.length, 1);
  const add = ops[0]!;
  assert.equal(add.kind, "add_decision");
  if (add.kind === "add_decision") assert.equal(add.decision.citation, undefined);
});

test("drops citations entirely when there is no attachment to cite", () => {
  const ops = parseExtractionResponse(
    JSON.stringify({ ops: [{ kind: "add_decision", choice: "x", citation: { fromLine: 1, toLine: 2 } }] }),
    { transcriptLineCount: 100 },
  );
  const add = ops[0]!;
  if (add.kind === "add_decision") assert.equal(add.decision.citation, undefined);
});

test("skips unknown kinds, malformed ops, and noop; keeps the valid ones", () => {
  const ops = parseExtractionResponse(
    JSON.stringify({
      ops: [
        { kind: "frobnicate", value: 1 }, // unknown
        { kind: "set_status", status: "not-a-status" }, // invalid enum
        { kind: "add_decision" }, // missing required choice
        { kind: "noop" }, // true no-op → dropped
        { kind: "add_env_note", note: "Node >=22.18" }, // valid
      ],
    }),
    CTX,
  );
  assert.deepEqual(ops, [{ kind: "add_env_note", note: "Node >=22.18" }]);
});

test("throws on a response with no JSON object at all", () => {
  assert.throws(() => parseExtractionResponse("I cannot help with that.", CTX));
});

test("extractCheckpoint drives the client and returns parsed ops", async () => {
  const canned = JSON.stringify({ ops: [{ kind: "set_status", status: "done" }] });
  let seen: LLMRequest | undefined;
  const client: LLMClient = {
    async complete(req: LLMRequest): Promise<LLMResponse> {
      seen = req;
      return { text: canned, model: "claude-opus-4-8", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  const ops = await extractCheckpoint(client, {
    delta: [msg({ line: 1, role: "assistant", text: "shipped it" })],
    state: emptyWorkingState(),
    transcriptLineCount: 10,
  });
  assert.deepEqual(ops, [{ kind: "set_status", status: "done" }]);
  assert.equal(seen?.model, "claude-opus-4-8");
  assert.ok((seen?.maxTokens ?? 0) > 0);
});
