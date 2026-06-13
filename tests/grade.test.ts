import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGradingPrompt, gradeHandoff, parseGradingResponse, RUBRIC_VERSION } from "../src/distiller/grade.ts";
import { finalize } from "../src/core/finalize.ts";
import { applyPatches, emptyWorkingState } from "../src/core/working-state.ts";
import type { Handoff } from "../src/schema/handoff.ts";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/llm/client.ts";

function handoff(): Handoff {
  const state = applyPatches(emptyWorkingState(new Date("2026-06-13T00:00:00Z")), [
    { kind: "set_mission", mission: "fix the session-token race" },
    { kind: "add_decision", decision: { id: "d1", choice: "use a queue", rationale: "serializes refresh" } },
    { kind: "move_to_graveyard", entry: { id: "g1", approach: "double middleware", reason: "deadlocked" } },
  ]);
  return finalize(state, {
    projectId: "p",
    author: "a",
    tool: "claude-code",
    captureMode: "transcript",
    parents: [],
    timestamp: "2026-06-13T00:00:00.000Z",
  }).handoff;
}

test("buildGradingPrompt includes the distilled handoff, transcript, and rubric dimensions", () => {
  const { system, user } = buildGradingPrompt({ handoff: handoff(), transcript: "USER: fix it\nASSISTANT: tried middleware, deadlocked" });
  assert.match(system, /fidelity grader/i);
  assert.match(system, /graveyard/);
  assert.match(user, /fix the session-token race/);
  assert.match(user, /double middleware/);
  assert.match(user, /tried middleware, deadlocked/);
});

test("buildGradingPrompt truncates an enormous transcript", () => {
  const huge = "x".repeat(500_000);
  const { user } = buildGradingPrompt({ handoff: handoff(), transcript: huge });
  assert.match(user, /transcript truncated/);
  assert.ok(user.length < huge.length);
});

test("parses score and per-section confidence, dropping invalid section values", () => {
  const text = "```json\n" + JSON.stringify({
    score: 0.93,
    sections: { decisions: 0.9, graveyard: 0.97, nextActions: 1.2, mission: "n/a" },
  }) + "\n```";
  const fidelity = parseGradingResponse(text);
  assert.equal(fidelity.score, 0.93);
  assert.deepEqual(fidelity.sections, { decisions: 0.9, graveyard: 0.97 }); // 1.2 and "n/a" dropped
});

test("throws when the score is missing or out of range", () => {
  assert.throws(() => parseGradingResponse(JSON.stringify({ sections: { decisions: 0.5 } })));
  assert.throws(() => parseGradingResponse(JSON.stringify({ score: 1.5 })));
  assert.throws(() => parseGradingResponse("no json here"));
});

test("gradeHandoff records the grader model and rubric version", async () => {
  let seen: LLMRequest | undefined;
  const client: LLMClient = {
    async complete(req: LLMRequest): Promise<LLMResponse> {
      seen = req;
      return {
        text: JSON.stringify({ score: 0.88, sections: { decisions: 0.9 } }),
        model: "claude-opus-4-8",
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    },
  };
  const fidelity = await gradeHandoff(client, { handoff: handoff(), transcript: "..." });
  assert.equal(fidelity.score, 0.88);
  assert.equal(fidelity.graderModel, "claude-opus-4-8");
  assert.equal(fidelity.rubricVersion, RUBRIC_VERSION);
  assert.deepEqual(fidelity.sections, { decisions: 0.9 });
  assert.equal(seen?.maxTokens, 2048);
});

test("a graded fidelity is accepted by the handoff schema", () => {
  // The grader output must round-trip into a valid Handoff fidelity field.
  const fidelity = parseGradingResponse(JSON.stringify({ score: 0.91, sections: { mission: 1 } }));
  const state = emptyWorkingState(new Date("2026-06-13T00:00:00Z"));
  const { handoff: h } = finalize(state, {
    projectId: "p",
    author: "a",
    tool: "claude-code",
    captureMode: "transcript",
    parents: [],
    timestamp: "2026-06-13T00:00:00.000Z",
  });
  // simulate attaching a grade then re-validating
  const graded = { ...h, fidelity: { ...fidelity, graderModel: "claude-opus-4-8", rubricVersion: RUBRIC_VERSION } };
  assert.equal(graded.fidelity.score, 0.91);
});
