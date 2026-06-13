/**
 * Handoff schema v1 — the sealed commit. See plan §2.1.
 *
 * Design notes:
 *  - A handoff is content-addressed: its id is the hash of its canonical
 *    JSON, computed AFTER validation. The id is never stored inside the
 *    document (a value can't contain its own hash).
 *  - Citations point into attachments (the raw transcript) by line span —
 *    transcripts are JSONL, so lines are the natural addressing unit.
 *  - `fidelity.score` is null until the grader runs (phase 2) or in
 *    fallback capture mode. Honesty over fake confidence.
 *  - Validation is strict: unknown keys are rejected (see validate.ts).
 */
import {
  arr,
  isoDatetime,
  literal,
  nullable,
  num,
  obj,
  oneOf,
  optStr,
  str,
  ValidationError,
} from "./validate.ts";

export const SCHEMA_VERSION = 1;

export const TOOL_IDS = ["claude-code", "codex", "cursor", "chatgpt-web", "other"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const CAPTURE_MODES = ["transcript", "self-report", "import", "fallback"] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];

export const HANDOFF_STATUSES = ["done", "in-progress", "blocked"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

/** A span of lines inside an attachment (1-based, inclusive). */
export interface Citation {
  attachmentId: string;
  fromLine: number;
  toLine: number;
}

export interface Decision {
  id: string;
  choice: string;
  rationale: string;
  citation?: Citation;
}

/** The highest-value field: what was tried and why it failed. */
export interface GraveyardEntry {
  id: string;
  approach: string;
  reason: string;
  citation?: Citation;
}

export interface FileRef {
  path: string;
  contentHash?: string;
}

export interface RepoMap {
  touched: FileRef[];
  important: FileRef[];
  entryPoints: string[];
}

export const ATTACHMENT_KINDS = ["transcript", "diff", "plan", "other"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  contentHash: string;
  bytes: number;
  /** Walrus blob id — null until uploaded (phase 3). */
  blobRef: string | null;
}

export interface Fidelity {
  /** 0–1, or null when ungraded (fallback mode, grader unavailable). */
  score: number | null;
  graderModel?: string;
  rubricVersion?: string;
  /** Per-section confidence, e.g. { graveyard: 0.97, decisions: 0.88 }. */
  sections?: Record<string, number>;
}

export interface HandoffMeta {
  projectId: string;
  branch?: string;
  tool: ToolId;
  captureMode: CaptureMode;
  model?: string;
  author: string;
  timestamp: string;
  /** Parent handoff ids — lineage DAG; merges have two parents. */
  parents: string[];
}

export interface Handoff {
  schemaVersion: typeof SCHEMA_VERSION;
  meta: HandoffMeta;
  mission: string;
  status: HandoffStatus;
  decisions: Decision[];
  graveyard: GraveyardEntry[];
  repoMap: RepoMap;
  nextActions: string[];
  envNotes: string[];
  attachments: Attachment[];
  verbatimRules: string[];
  fidelity: Fidelity;
}

// ---------------------------------------------------------------------------
// Parsers — each takes (value, path) and returns the typed value or throws.
// ---------------------------------------------------------------------------

function parseCitation(v: unknown, path: string): Citation {
  const r = obj(v, path, ["attachmentId", "fromLine", "toLine"]);
  const fromLine = num(r.fromLine, `${path}.fromLine`, { int: true, min: 1 });
  const toLine = num(r.toLine, `${path}.toLine`, { int: true, min: 1 });
  if (toLine < fromLine) throw new ValidationError(`${path}.toLine`, "must be >= fromLine");
  return { attachmentId: str(r.attachmentId, `${path}.attachmentId`, { min: 1 }), fromLine, toLine };
}

function optCitation(v: unknown, path: string): Citation | undefined {
  return v === undefined ? undefined : parseCitation(v, path);
}

function withoutUndefined<T extends object>(value: T): T {
  // Keep parsed objects byte-identical to their canonical form: optional
  // fields that are absent must not appear as `key: undefined` either.
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function parseDecision(v: unknown, path: string): Decision {
  const r = obj(v, path, ["id", "choice", "rationale", "citation"]);
  return withoutUndefined({
    id: str(r.id, `${path}.id`, { min: 1 }),
    choice: str(r.choice, `${path}.choice`, { min: 1 }),
    rationale: str(r.rationale, `${path}.rationale`),
    citation: optCitation(r.citation, `${path}.citation`),
  });
}

function parseGraveyardEntry(v: unknown, path: string): GraveyardEntry {
  const r = obj(v, path, ["id", "approach", "reason", "citation"]);
  return withoutUndefined({
    id: str(r.id, `${path}.id`, { min: 1 }),
    approach: str(r.approach, `${path}.approach`, { min: 1 }),
    reason: str(r.reason, `${path}.reason`),
    citation: optCitation(r.citation, `${path}.citation`),
  });
}

function parseFileRef(v: unknown, path: string): FileRef {
  const r = obj(v, path, ["path", "contentHash"]);
  return withoutUndefined({
    path: str(r.path, `${path}.path`, { min: 1 }),
    contentHash: optStr(r.contentHash, `${path}.contentHash`),
  });
}

function parseRepoMap(v: unknown, path: string): RepoMap {
  const r = obj(v, path, ["touched", "important", "entryPoints"]);
  return {
    touched: arr(r.touched, `${path}.touched`, parseFileRef),
    important: arr(r.important, `${path}.important`, parseFileRef),
    entryPoints: arr(r.entryPoints, `${path}.entryPoints`, (e, p) => str(e, p)),
  };
}

function parseAttachment(v: unknown, path: string): Attachment {
  const r = obj(v, path, ["id", "kind", "contentHash", "bytes", "blobRef"]);
  return {
    id: str(r.id, `${path}.id`, { min: 1 }),
    kind: oneOf(r.kind, `${path}.kind`, ATTACHMENT_KINDS),
    contentHash: str(r.contentHash, `${path}.contentHash`, { min: 1 }),
    bytes: num(r.bytes, `${path}.bytes`, { int: true, min: 0 }),
    blobRef: nullable(r.blobRef, `${path}.blobRef`, (b, p) => str(b, p)),
  };
}

function parseFidelity(v: unknown, path: string): Fidelity {
  const r = obj(v, path, ["score", "graderModel", "rubricVersion", "sections"]);
  const out: Fidelity = {
    score: nullable(r.score, `${path}.score`, (s, p) => num(s, p, { min: 0, max: 1 })),
  };
  const graderModel = optStr(r.graderModel, `${path}.graderModel`);
  if (graderModel !== undefined) out.graderModel = graderModel;
  const rubricVersion = optStr(r.rubricVersion, `${path}.rubricVersion`);
  if (rubricVersion !== undefined) out.rubricVersion = rubricVersion;
  if (r.sections !== undefined) {
    const sectionsRaw = r.sections;
    if (typeof sectionsRaw !== "object" || sectionsRaw === null || Array.isArray(sectionsRaw)) {
      throw new ValidationError(`${path}.sections`, "expected object");
    }
    const sections: Record<string, number> = {};
    for (const [key, val] of Object.entries(sectionsRaw)) {
      sections[key] = num(val, `${path}.sections.${key}`, { min: 0, max: 1 });
    }
    out.sections = sections;
  }
  return out;
}

function parseMeta(v: unknown, path: string): HandoffMeta {
  const r = obj(v, path, [
    "projectId",
    "branch",
    "tool",
    "captureMode",
    "model",
    "author",
    "timestamp",
    "parents",
  ]);
  return withoutUndefined({
    projectId: str(r.projectId, `${path}.projectId`, { min: 1 }),
    branch: optStr(r.branch, `${path}.branch`),
    tool: oneOf(r.tool, `${path}.tool`, TOOL_IDS),
    captureMode: oneOf(r.captureMode, `${path}.captureMode`, CAPTURE_MODES),
    model: optStr(r.model, `${path}.model`),
    author: str(r.author, `${path}.author`, { min: 1 }),
    timestamp: isoDatetime(r.timestamp, `${path}.timestamp`),
    parents: arr(r.parents, `${path}.parents`, (p, pp) => str(p, pp)),
  });
}

/** Parse + validate an untrusted value into a Handoff, or throw ValidationError. */
export function parseHandoff(value: unknown): Handoff {
  const r = obj(value, "handoff", [
    "schemaVersion",
    "meta",
    "mission",
    "status",
    "decisions",
    "graveyard",
    "repoMap",
    "nextActions",
    "envNotes",
    "attachments",
    "verbatimRules",
    "fidelity",
  ]);
  return {
    schemaVersion: literal(r.schemaVersion, "handoff.schemaVersion", SCHEMA_VERSION),
    meta: parseMeta(r.meta, "handoff.meta"),
    mission: str(r.mission, "handoff.mission"),
    status: oneOf(r.status, "handoff.status", HANDOFF_STATUSES),
    decisions: arr(r.decisions, "handoff.decisions", parseDecision),
    graveyard: arr(r.graveyard, "handoff.graveyard", parseGraveyardEntry),
    repoMap: parseRepoMap(r.repoMap, "handoff.repoMap"),
    nextActions: arr(r.nextActions, "handoff.nextActions", (a, p) => str(a, p)),
    envNotes: arr(r.envNotes, "handoff.envNotes", (n, p) => str(n, p)),
    attachments: arr(r.attachments, "handoff.attachments", parseAttachment),
    verbatimRules: arr(r.verbatimRules, "handoff.verbatimRules", (rl, p) => str(rl, p)),
    fidelity: parseFidelity(r.fidelity, "handoff.fidelity"),
  };
}
