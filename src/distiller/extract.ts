/**
 * Micro-checkpoint extractor (plan §3.3 step 1).
 *
 * Given a small delta of recent transcript turns plus the current rolling
 * WorkingState, ask the model to propose patch operations (ADD a decision,
 * MOVE an approach to the graveyard, UPDATE status, ...). Small targets, small
 * errors, self-correcting — latest truth wins.
 *
 * Three pieces, separable for testing:
 *  - buildExtractionPrompt — pure; assembles the system + user prompt.
 *  - parseExtractionResponse — pure; strictly validates the model's JSON into
 *    PatchOps. Resilient at the LLM boundary: individual malformed or unknown
 *    ops are skipped (a model is nondeterministic) while well-formed ones are
 *    kept; citations are dropped unless they point inside the transcript.
 *  - extractCheckpoint — the IO step: build → client.complete → parse.
 */
import { randomUUID } from "node:crypto";
import {
  HANDOFF_STATUSES,
  type Citation,
  type Decision,
  type HandoffStatus,
} from "../schema/handoff.ts";
import type { PatchOp, WorkingState } from "../core/working-state.ts";
import type { CaptureMessage } from "./capture/transcript.ts";
import { DEFAULT_MODEL, type Effort, type LLMClient } from "../llm/client.ts";
import { extractJsonObject } from "./json.ts";

export interface ExtractionInput {
  /** Recent transcript turns to distill (the delta since the last checkpoint). */
  delta: CaptureMessage[];
  /** Current rolling state — context so the model can update rather than duplicate. */
  state: WorkingState;
  /** Total lines in the source transcript — bounds citation ranges. */
  transcriptLineCount: number;
  /** The attachment citations point into; without it, citations are dropped. */
  attachmentId?: string;
}

export interface ExtractOptions {
  model?: string;
  maxTokens?: number;
  effort?: Effort;
}

const MAX_FIELD = 2000;

function truncate(s: string, max = MAX_FIELD): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function renderDelta(delta: CaptureMessage[]): string {
  const out: string[] = [];
  for (const m of delta) {
    if (m.isMeta) continue; // tool-injected reminders aren't session content
    const head = `[line ${m.line}] ${m.role}`;
    if (m.thinking) out.push(`${head} (thinking): ${truncate(m.thinking)}`);
    if (m.text) out.push(`${head}: ${truncate(m.text)}`);
    for (const t of m.toolUses) out.push(`${head} → tool ${t.name}(${truncate(JSON.stringify(t.input ?? {}), 400)})`);
    for (const r of m.toolResults) {
      out.push(`${head} ← tool result${r.isError ? " [error]" : ""}: ${truncate(r.text, 600)}`);
    }
  }
  return out.join("\n");
}

function renderState(state: WorkingState): string {
  const decisions = state.decisions.map((d) => `  - [${d.id}] ${d.choice}`).join("\n") || "  (none)";
  const graveyard = state.graveyard.map((g) => `  - ${g.approach}`).join("\n") || "  (none)";
  return [
    `mission: ${state.mission || "(unset)"}`,
    `status: ${state.status}`,
    `decisions:\n${decisions}`,
    `graveyard:\n${graveyard}`,
    `nextActions: ${state.nextActions.length ? state.nextActions.join("; ") : "(none)"}`,
  ].join("\n");
}

const SYSTEM_PROMPT = `You maintain a structured "working state" for a live coding-agent session — the durable memory another agent will resume from.

From the recent transcript delta and the current working state, propose patch operations. Only record what the delta actually supports; do not invent. The single highest-value signal is the GRAVEYARD: approaches that were tried and failed, and why — so the next agent does not repeat them.

Respond with ONLY a JSON object, no prose, of the form:
{"ops": [ <op>, ... ]}

Each <op> is one of:
{"kind":"set_mission","mission":"..."}
{"kind":"set_status","status":"done|in-progress|blocked"}
{"kind":"add_decision","choice":"...","rationale":"...","citation":{"fromLine":N,"toLine":M}}
{"kind":"update_decision","id":"<existing decision id>","choice":"...","rationale":"..."}
{"kind":"move_to_graveyard","approach":"...","reason":"...","citation":{"fromLine":N,"toLine":M}}
{"kind":"set_next_actions","actions":["...","..."]}
{"kind":"add_env_note","note":"..."}
{"kind":"add_verbatim_rule","rule":"..."}
{"kind":"noop"}

Rules: cite transcript line numbers (from the [line N] markers) whenever a claim comes from a specific span; omit "citation" when unsure. Prefer update_decision over a duplicate add_decision. Emit a single {"kind":"noop"} if the delta contains nothing worth recording.`;

export function buildExtractionPrompt(input: ExtractionInput): { system: string; user: string } {
  const user = [
    "## Current working state",
    renderState(input.state),
    "",
    "## Recent transcript delta",
    renderDelta(input.delta) || "(empty)",
    "",
    "Propose the patch operations as the specified JSON object.",
  ].join("\n");
  return { system: SYSTEM_PROMPT, user };
}

// ---------------------------------------------------------------------------
// Parsing — strict per-op validation, resilient to individual bad ops.
// ---------------------------------------------------------------------------

const str = (o: Record<string, unknown>, k: string): string | undefined =>
  typeof o[k] === "string" && (o[k] as string).length > 0 ? (o[k] as string) : undefined;

function citationOf(
  raw: unknown,
  transcriptLineCount: number,
  attachmentId: string | undefined,
): Citation | undefined {
  if (!attachmentId || !raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const from = c.fromLine;
  const to = c.toLine;
  if (typeof from !== "number" || typeof to !== "number") return undefined;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return undefined;
  if (from < 1 || to < from || to > transcriptLineCount) return undefined; // out of range → drop
  return { attachmentId, fromLine: from, toLine: to };
}

function buildOp(
  raw: unknown,
  ctx: { transcriptLineCount: number; attachmentId?: string },
): PatchOp | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const cite = (k = "citation"): Citation | undefined =>
    citationOf(o[k], ctx.transcriptLineCount, ctx.attachmentId);

  switch (o.kind) {
    case "set_mission": {
      const mission = str(o, "mission");
      return mission ? { kind: "set_mission", mission } : null;
    }
    case "set_status": {
      const status = o.status;
      return typeof status === "string" && (HANDOFF_STATUSES as readonly string[]).includes(status)
        ? { kind: "set_status", status: status as HandoffStatus }
        : null;
    }
    case "add_decision": {
      const choice = str(o, "choice");
      if (!choice) return null;
      const decision: Decision = { id: `d-${randomUUID()}`, choice, rationale: str(o, "rationale") ?? "" };
      const citation = cite();
      if (citation) decision.citation = citation;
      return { kind: "add_decision", decision };
    }
    case "update_decision": {
      const id = str(o, "id");
      if (!id) return null;
      const patch: Partial<Omit<Decision, "id">> = {};
      const choice = str(o, "choice");
      const rationale = str(o, "rationale");
      const citation = cite();
      if (choice) patch.choice = choice;
      if (rationale !== undefined) patch.rationale = rationale;
      if (citation) patch.citation = citation;
      return Object.keys(patch).length > 0 ? { kind: "update_decision", id, patch } : null;
    }
    case "move_to_graveyard": {
      const approach = str(o, "approach");
      if (!approach) return null;
      const entry = { id: `g-${randomUUID()}`, approach, reason: str(o, "reason") ?? "" } as {
        id: string;
        approach: string;
        reason: string;
        citation?: Citation;
      };
      const citation = cite();
      if (citation) entry.citation = citation;
      const decisionId = str(o, "decisionId");
      return decisionId ? { kind: "move_to_graveyard", entry, decisionId } : { kind: "move_to_graveyard", entry };
    }
    case "set_next_actions": {
      if (!Array.isArray(o.actions)) return null;
      const actions = o.actions.filter((a): a is string => typeof a === "string" && a.length > 0);
      return actions.length > 0 ? { kind: "set_next_actions", actions } : null;
    }
    case "add_env_note": {
      const note = str(o, "note");
      return note ? { kind: "add_env_note", note } : null;
    }
    case "add_verbatim_rule": {
      const rule = str(o, "rule");
      return rule ? { kind: "add_verbatim_rule", rule } : null;
    }
    case "noop":
      return null; // a true no-op carries no state change; drop it
    default:
      return null; // unknown kind — skip, don't fail the whole checkpoint
  }
}

export function parseExtractionResponse(
  text: string,
  ctx: { transcriptLineCount: number; attachmentId?: string },
): PatchOp[] {
  const obj = extractJsonObject(text);
  const rawOps = Array.isArray(obj.ops) ? obj.ops : [];
  const ops: PatchOp[] = [];
  for (const raw of rawOps) {
    const op = buildOp(raw, ctx);
    if (op) ops.push(op);
  }
  return ops;
}

export async function extractCheckpoint(
  client: LLMClient,
  input: ExtractionInput,
  opts: ExtractOptions = {},
): Promise<PatchOp[]> {
  const { system, user } = buildExtractionPrompt(input);
  const res = await client.complete({
    system,
    messages: [{ role: "user", content: user }],
    model: opts.model ?? DEFAULT_MODEL,
    maxTokens: opts.maxTokens ?? 8192,
    effort: opts.effort,
  });
  return parseExtractionResponse(res.text, {
    transcriptLineCount: input.transcriptLineCount,
    attachmentId: input.attachmentId,
  });
}
