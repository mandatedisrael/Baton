/**
 * Fidelity grader (plan §3.3 step 4).
 *
 * After a handoff is finalized, a model grades the distillation against the
 * source transcript: were the decisions captured? does the graveyard match the
 * failures that actually happened? are the next actions consistent with where
 * the session ended? The score (0–1, plus per-section confidence) is written
 * into `fidelity` and later attested on-chain (phase 3).
 *
 * Same shape as the extractor: pure prompt-build, pure response-parse, and an
 * IO step. The grader's job is honesty — `fidelity.score` stays null until this
 * runs, and the grader model id + rubric version are recorded alongside it.
 */
import type { Fidelity, Handoff } from "../schema/handoff.ts";
import { DEFAULT_MODEL, LLMError, type Effort, type LLMClient } from "../llm/client.ts";
import { extractJsonObject } from "./json.ts";

export const RUBRIC_VERSION = "v1" as const;

const MAX_TRANSCRIPT = 400_000; // generous cap; full transcripts fit Opus 4.8's 1M context

export interface GradeInput {
  handoff: Handoff;
  /** The raw source transcript the handoff was distilled from. */
  transcript: string;
}

export interface GradeOptions {
  model?: string;
  maxTokens?: number;
  effort?: Effort;
}

const SYSTEM_PROMPT = `You are a fidelity grader. You are given a distilled session handoff (JSON) and the raw source transcript it was distilled from. Judge how faithfully the handoff represents what actually happened in the transcript.

Score each dimension from 0 to 1:
- decisions: are the recorded decisions real, and is the rationale accurate?
- graveyard: do the recorded failures match approaches that actually failed, for the stated reasons?
- nextActions: are they consistent with where the session ended?
- mission: does it match the session's actual goal?
Then give an overall "score" (0–1) reflecting whether an agent resuming from this handoff would have an accurate picture. Penalize fabrication (claims not supported by the transcript) far more than omission.

Respond with ONLY a JSON object:
{"score": 0.0-1.0, "sections": {"decisions": 0.0-1.0, "graveyard": 0.0-1.0, "nextActions": 0.0-1.0, "mission": 0.0-1.0}}`;

function distilled(handoff: Handoff): string {
  return JSON.stringify(
    {
      mission: handoff.mission,
      status: handoff.status,
      decisions: handoff.decisions,
      graveyard: handoff.graveyard,
      nextActions: handoff.nextActions,
      envNotes: handoff.envNotes,
      verbatimRules: handoff.verbatimRules,
    },
    null,
    2,
  );
}

export function buildGradingPrompt(input: GradeInput): { system: string; user: string } {
  const transcript =
    input.transcript.length <= MAX_TRANSCRIPT
      ? input.transcript
      : `${input.transcript.slice(0, MAX_TRANSCRIPT)}\n…[transcript truncated]`;
  const user = [
    "## Distilled handoff",
    distilled(input.handoff),
    "",
    "## Source transcript",
    transcript,
    "",
    "Grade the handoff as the specified JSON object.",
  ].join("\n");
  return { system: SYSTEM_PROMPT, user };
}

function unit(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}

/** Parse a grader response into a Fidelity (without graderModel/rubricVersion). */
export function parseGradingResponse(text: string): Fidelity {
  const obj = extractJsonObject(text);
  const score = unit(obj.score);
  if (score === undefined) {
    throw new LLMError("grader response missing a valid 'score' in [0,1]", { code: "bad_response" });
  }
  const fidelity: Fidelity = { score };

  if (obj.sections && typeof obj.sections === "object" && !Array.isArray(obj.sections)) {
    const sections: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj.sections as Record<string, unknown>)) {
      const s = unit(v);
      if (s !== undefined) sections[k] = s;
    }
    if (Object.keys(sections).length > 0) fidelity.sections = sections;
  }
  return fidelity;
}

export async function gradeHandoff(
  client: LLMClient,
  input: GradeInput,
  opts: GradeOptions = {},
): Promise<Fidelity> {
  const model = opts.model ?? DEFAULT_MODEL;
  const { system, user } = buildGradingPrompt(input);
  const res = await client.complete({
    system,
    messages: [{ role: "user", content: user }],
    model,
    maxTokens: opts.maxTokens ?? 2048,
    effort: opts.effort,
  });
  const fidelity = parseGradingResponse(res.text);
  fidelity.graderModel = res.model || model;
  fidelity.rubricVersion = RUBRIC_VERSION;
  return fidelity;
}
