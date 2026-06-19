import { DEFAULT_MODEL, LLMError } from "../llm/client.js";
import { extractJsonObject } from "./json.js";
export const RUBRIC_VERSION = "v1";
const MAX_TRANSCRIPT = 400_000; // generous cap; full transcripts fit Opus 4.8's 1M context
const SYSTEM_PROMPT = `You are a fidelity grader. You are given a distilled session handoff (JSON) and the raw source transcript it was distilled from. Judge how faithfully the handoff represents what actually happened in the transcript.

Score each dimension from 0 to 1:
- decisions: are the recorded decisions real, and is the rationale accurate?
- graveyard: do the recorded failures match approaches that actually failed, for the stated reasons?
- nextActions: are they consistent with where the session ended?
- mission: does it match the session's actual goal?
Then give an overall "score" (0–1) reflecting whether an agent resuming from this handoff would have an accurate picture. Penalize fabrication (claims not supported by the transcript) far more than omission.

Respond with ONLY a JSON object:
{"score": 0.0-1.0, "sections": {"decisions": 0.0-1.0, "graveyard": 0.0-1.0, "nextActions": 0.0-1.0, "mission": 0.0-1.0}}`;
function distilled(handoff) {
    return JSON.stringify({
        mission: handoff.mission,
        status: handoff.status,
        decisions: handoff.decisions,
        graveyard: handoff.graveyard,
        nextActions: handoff.nextActions,
        envNotes: handoff.envNotes,
        verbatimRules: handoff.verbatimRules,
    }, null, 2);
}
export function buildGradingPrompt(input) {
    const transcript = input.transcript.length <= MAX_TRANSCRIPT
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
function unit(v) {
    return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}
/** Parse a grader response into a Fidelity (without graderModel/rubricVersion). */
export function parseGradingResponse(text) {
    const obj = extractJsonObject(text);
    const score = unit(obj.score);
    if (score === undefined) {
        throw new LLMError("grader response missing a valid 'score' in [0,1]", { code: "bad_response" });
    }
    const fidelity = { score };
    if (obj.sections && typeof obj.sections === "object" && !Array.isArray(obj.sections)) {
        const sections = {};
        for (const [k, v] of Object.entries(obj.sections)) {
            const s = unit(v);
            if (s !== undefined)
                sections[k] = s;
        }
        if (Object.keys(sections).length > 0)
            fidelity.sections = sections;
    }
    return fidelity;
}
export async function gradeHandoff(client, input, opts = {}) {
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
//# sourceMappingURL=grade.js.map