/**
 * ProjectStore — local persistence for one project.
 *
 * Two principles, established here in phase 1 and never relaxed:
 *
 *  1. Verify-on-read: every handoff loaded from disk is re-hashed and
 *     compared to its filename id. A mismatch is a loud HASH_MISMATCH —
 *     the local echo of verify-on-resume (plan §2.3).
 *  2. Atomic writes: state and config are written via tmp-file + rename,
 *     so a crash mid-write never corrupts the store.
 *
 * NOTE: the local cache is plaintext-with-0600 in phase 1. At-rest
 * encryption of local state arrives with Seal integration (phase 3).
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { BatonError } from "../core/errors.ts";
import { hashBytes, hashCanonical } from "../core/hash.ts";
import { emptyWorkingState, type WorkingState } from "../core/working-state.ts";
import { parseHandoff, type Attachment, type Handoff } from "../schema/handoff.ts";
import { isoDatetime, literal, nullable, obj, str } from "../schema/validate.ts";
import {
  batonDir,
  attachmentPath,
  attachmentsDir,
  configPath,
  cursorPath,
  findProjectRoot,
  handoffPath,
  handoffsDir,
  workingStatePath,
} from "./paths.ts";

/** Where the distiller has read up to — so each checkpoint sees only new turns. */
export interface CheckpointCursor {
  /** The Claude Code session whose transcript was last distilled. */
  sessionId: string | null;
  /** Highest transcript line already folded into the working state. */
  line: number;
  /** Path to that session's transcript — recorded so `pass` can attach the source. */
  transcriptPath: string | null;
}

export const EMPTY_CURSOR: CheckpointCursor = { sessionId: null, line: 0, transcriptPath: null };

export interface ProjectConfig {
  schemaVersion: 1;
  projectId: string;
  createdAt: string;
  /** Latest handoff id, parent of the next pass. Branch heads arrive in phase 3. */
  head: string | null;
}

function parseProjectConfig(v: unknown): ProjectConfig {
  const r = obj(v, "config", ["schemaVersion", "projectId", "createdAt", "head"]);
  return {
    schemaVersion: literal(r.schemaVersion, "config.schemaVersion", 1),
    projectId: str(r.projectId, "config.projectId", { min: 1 }),
    createdAt: isoDatetime(r.createdAt, "config.createdAt"),
    head: nullable(r.head, "config.head", (h, p) => str(h, p)),
  };
}

export class ProjectStore {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  /** Create .baton/ in `root`. Errors if already initialized. */
  static init(root: string, now: Date = new Date()): ProjectStore {
    if (existsSync(batonDir(root))) {
      throw new BatonError("ALREADY_INITIALIZED", `already a baton project: ${batonDir(root)}`);
    }
    mkdirSync(handoffsDir(root), { recursive: true });
    mkdirSync(attachmentsDir(root), { recursive: true });
    mkdirSync(dirname(workingStatePath(root)), { recursive: true });
    const store = new ProjectStore(root);
    store.writeConfig({
      schemaVersion: 1,
      projectId: randomUUID(),
      createdAt: now.toISOString(),
      head: null,
    });
    store.saveWorkingState(emptyWorkingState(now));
    return store;
  }

  /** Open the project containing `cwd` (walks up). Errors if none found. */
  static open(cwd: string): ProjectStore {
    const root = findProjectRoot(cwd);
    if (root === null) {
      throw new BatonError(
        "NOT_INITIALIZED",
        "not a baton project (no .baton directory here or in any parent) — run `baton init`",
      );
    }
    return new ProjectStore(root);
  }

  // -- config ---------------------------------------------------------------

  config(): ProjectConfig {
    try {
      return parseProjectConfig(this.readJson(configPath(this.root)));
    } catch (err) {
      if (err instanceof BatonError) throw err;
      throw new BatonError("INVALID_STATE", "config.json is invalid", { cause: err });
    }
  }

  setHead(id: string): void {
    this.writeConfig({ ...this.config(), head: id });
  }

  // -- working state ----------------------------------------------------------

  loadWorkingState(): WorkingState {
    return this.readJson(workingStatePath(this.root)) as WorkingState;
  }

  // -- checkpoint cursor ------------------------------------------------------

  /** Where the distiller left off. Returns the empty cursor if none yet. */
  loadCursor(): CheckpointCursor {
    if (!existsSync(cursorPath(this.root))) return { ...EMPTY_CURSOR };
    try {
      const r = obj(this.readJson(cursorPath(this.root)), "cursor", ["sessionId", "line", "transcriptPath"]);
      return {
        sessionId: nullable(r.sessionId, "cursor.sessionId", (s, p) => str(s, p)),
        line: typeof r.line === "number" && Number.isInteger(r.line) && r.line >= 0 ? r.line : 0,
        transcriptPath: nullable(r.transcriptPath ?? null, "cursor.transcriptPath", (s, p) => str(s, p)),
      };
    } catch {
      return { ...EMPTY_CURSOR }; // a corrupt cursor just means "redistill from the start"
    }
  }

  saveCursor(cursor: CheckpointCursor): void {
    this.writeJsonAtomic(cursorPath(this.root), cursor);
  }

  saveWorkingState(state: WorkingState): void {
    this.writeJsonAtomic(workingStatePath(this.root), state);
  }

  // -- handoffs ----------------------------------------------------------------

  /** Persist a finalized handoff. The id is recomputed and must match. */
  saveHandoff(handoff: Handoff, id: string): void {
    const actual = hashCanonical(handoff);
    if (actual !== id) {
      throw new BatonError("HASH_MISMATCH", `handoff hash ${actual} does not match id ${id}`);
    }
    this.writeJsonAtomic(handoffPath(this.root, id), handoff);
  }

  /** Load + validate + verify a handoff. Loud refusal on tampering. */
  loadHandoff(id: string): Handoff {
    const path = handoffPath(this.root, id);
    if (!existsSync(path)) {
      throw new BatonError("NOT_FOUND", `no handoff ${id}`);
    }
    const handoff = parseHandoff(this.readJson(path));
    const actual = hashCanonical(handoff);
    if (actual !== id) {
      throw new BatonError(
        "HASH_MISMATCH",
        `handoff ${id} failed verification (content hashes to ${actual}) — refusing to use it`,
      );
    }
    return handoff;
  }

  /** All handoff ids on disk (unordered; callers sort by timestamp). */
  listHandoffIds(): string[] {
    const dir = handoffsDir(this.root);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length));
  }

  // -- attachments -----------------------------------------------------------

  /**
   * Persist attachment bytes under their content hash. Existing bytes are
   * verified and reused, making retries idempotent.
   */
  saveAttachment(attachment: Attachment, data: Uint8Array | string): void {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    this.validateAttachmentBytes(attachment, bytes);
    const path = this.verifiedAttachmentPath(attachment.contentHash);
    if (existsSync(path)) {
      this.loadAttachment(attachment);
      return;
    }
    this.writeBytesAtomic(path, bytes);
  }

  /** Load attachment bytes and loudly refuse missing or tampered content. */
  loadAttachment(attachment: Attachment): Buffer {
    const path = this.verifiedAttachmentPath(attachment.contentHash);
    if (!existsSync(path)) {
      throw new BatonError("NOT_FOUND", `attachment ${attachment.id} is not available locally`);
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (err) {
      throw new BatonError("IO_ERROR", `failed reading attachment ${attachment.id}`, { cause: err });
    }
    this.validateAttachmentBytes(attachment, bytes);
    return bytes;
  }

  // -- internals ----------------------------------------------------------------

  private readJson(path: string): unknown {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      throw new BatonError("IO_ERROR", `failed reading ${path}`, { cause: err });
    }
  }

  private writeConfig(config: ProjectConfig): void {
    this.writeJsonAtomic(configPath(this.root), config);
  }

  private verifiedAttachmentPath(contentHash: string): string {
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      throw new BatonError("INVALID_HANDOFF", "attachment content hash must be 64 lowercase hex characters");
    }
    return attachmentPath(this.root, contentHash);
  }

  private validateAttachmentBytes(attachment: Attachment, bytes: Uint8Array): void {
    if (bytes.byteLength !== attachment.bytes) {
      throw new BatonError(
        "HASH_MISMATCH",
        `attachment ${attachment.id} expected ${attachment.bytes} bytes, received ${bytes.byteLength}`,
      );
    }
    const actual = hashBytes(bytes);
    if (actual !== attachment.contentHash) {
      throw new BatonError(
        "HASH_MISMATCH",
        `attachment ${attachment.id} failed verification (content hashes to ${actual})`,
      );
    }
  }

  private writeBytesAtomic(path: string, value: Uint8Array): void {
    const tmp = `${path}.tmp`;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(tmp, value, { mode: 0o600 });
      renameSync(tmp, path);
    } catch (err) {
      throw new BatonError("IO_ERROR", `failed writing ${path}`, { cause: err });
    }
  }

  private writeJsonAtomic(path: string, value: unknown): void {
    const tmp = `${path}.tmp`;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
      renameSync(tmp, path);
    } catch (err) {
      throw new BatonError("IO_ERROR", `failed writing ${path}`, { cause: err });
    }
  }
}
